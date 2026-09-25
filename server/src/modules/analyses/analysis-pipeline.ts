import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  AnalysisSections,
  GenerateContext,
  KnownItem,
  LlmAdapter,
  LocalMockAdapter,
  VideoItem,
} from './model-adapter';
import {
  EvidenceRetriever,
  LocalEvidenceRetriever,
  RETRIEVAL_STRATEGY,
  RetrievedChunk,
} from '../evidence/evidence-retrieval';
import { beijingDate } from '../../common/time.util';

/**
 * 一页分析流水线（RAG + 安全流程，docs/system-design.md 第 5 节）。
 * 纯 TS 编排（不依赖 Nest 容器）：API 服务创建任务，独立 Worker 进程调用 consumeOneTask 消费。
 *
 * 流程：证据库内受控检索 → 大模型适配层生成草稿（缺失即未知、不补写概率、五段固定）
 *       → 陈述提取 + 引用核对（剔除无依据陈述）→ 保存 analysis + analysis_citation。
 * 失败（模型 / 检索 / 来源校验）：任务状态 failed + 回退，不无限重试（attempts 上限 3）。
 *
 * T11：受控检索改为调用 evidence 模块的检索服务（LocalEvidenceRetriever，即 EvidenceService.search
 * 的同一实现）；检索快照直接采用该服务返回的 retrieval_snapshot（策略名 / 命中 doc_ids / 耗时）。
 */

/** 最大尝试次数（达到后标记 failed，不再重试） */
export const MAX_ATTEMPTS = 3;

/** 不可重试的流水线错误（校验失败，重试无意义） */
export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineError';
  }
}

/** 任务负载（POST /analyses 时写入 analysis_task.payload） */
export interface TaskPayload {
  episode_id: string;
  texts?: { symptom_change?: string; report_text?: string; question?: string };
  safety_flag: 'none' | 'seek_care' | 'stop_personal';
  matched?: { rule_code: string; label: string; severity: string }[];
}

export interface ConsumeResult {
  processed: boolean;
  taskId?: string;
  /** completed=完成；failed=失败（回退）；queued=稍后重试 */
  status?: 'completed' | 'failed' | 'queued';
  analysisId?: string;
  reason?: string;
}

interface TaskRow {
  id: string;
  episode_id: string;
  user_id: string;
  payload: string;
  status: string;
  attempts: number;
  safety_flag: string | null;
  result_analysis_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();

/**
 * 消费一个排队中的任务（Worker 每次轮询调用一次）。
 * 返回处理结果；无排队任务时 processed=false。
 */
export function consumeOneTask(
  db: DatabaseSync,
  adapter: LlmAdapter = new LocalMockAdapter(),
  retriever?: EvidenceRetriever,
): ConsumeResult {
  const task = db
    .prepare(`SELECT * FROM analysis_task WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1`)
    .get() as TaskRow | undefined;
  if (!task) return { processed: false };

  const attempts = (task.attempts ?? 0) + 1;
  try {
    const analysisId = runPipeline(db, task, adapter, retriever);
    db.prepare(
      `UPDATE analysis_task SET status='completed', result_analysis_id=?, attempts=?, error=NULL, updated_at=? WHERE id=?`,
    ).run(analysisId, attempts, now(), task.id);
    return { processed: true, taskId: task.id, status: 'completed', analysisId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : '处理失败';
    // 校验类错误（PipelineError）不重试；其余错误在 attempts 上限内重试
    const canRetry = !(err instanceof PipelineError) && attempts < MAX_ATTEMPTS;
    if (canRetry) {
      db.prepare(`UPDATE analysis_task SET status='queued', attempts=?, error=?, updated_at=? WHERE id=?`).run(
        attempts,
        reason,
        now(),
        task.id,
      );
      return { processed: true, taskId: task.id, status: 'queued', reason };
    }
    db.prepare(`UPDATE analysis_task SET status='failed', attempts=?, error=?, updated_at=? WHERE id=?`).run(
      attempts,
      reason,
      now(),
      task.id,
    );
    return { processed: true, taskId: task.id, status: 'failed', reason };
  }
}

/** 执行一次分析：检索 → 生成 → 核对 → 保存；校验失败抛 PipelineError */
function runPipeline(
  db: DatabaseSync,
  task: TaskRow,
  adapter: LlmAdapter,
  retriever?: EvidenceRetriever,
): string {
  const payload = JSON.parse(task.payload) as TaskPayload;
  const episodeId = payload.episode_id;

  // 1. 取「生效」状态的模型发布（模型 / 检索 / 内容版本快照来源）
  const modelRelease = db
    .prepare(`SELECT * FROM model_release WHERE status='生效' ORDER BY created_at DESC LIMIT 1`)
    .get() as
    | {
        id: string;
        model_name: string;
        prompt_version: string;
        retrieval_strategy: string | null;
        content_lib_version: string | null;
      }
    | undefined;
  if (!modelRelease) {
    throw new PipelineError('模型校验失败：没有生效的模型发布记录');
  }

  // 2. 受控检索：只在证据库内检索（调用 evidence 模块的检索服务，停用的证据立即不再被检索到）
  const query = buildQuery(db, episodeId, payload);
  const evidenceService = retriever ?? new LocalEvidenceRetriever(db);
  const outcome = evidenceService.search(query, 5);
  const evidence: RetrievedChunk[] = outcome.results;
  if (evidence.length === 0) {
    throw new PipelineError('检索校验失败：证据库内未检索到相关片段');
  }

  // 3. 已知段（确定性构建，带 care_event_id，前端可定位原文）
  const known = buildKnown(db, episodeId);

  // 4. 候选视频（受「视频推荐」开关控制）
  const videos = switchEnabled(db, '视频推荐') ? buildVideoCandidates(db) : [];

  // 5. 上下文（缺失信息用于「未知」段，不补写）
  const context = buildContext(db, episodeId, payload);

  // 6. 生成草稿（五段固定）
  const draft = adapter.generateDraft({ known, videoCandidates: videos, evidence, context });

  // 7. 陈述提取 + 引用核对：剔除无依据陈述
  const { sections, removed } = adapter.verifyStatements(draft, evidence);
  if (draft.explain.length > 0 && sections.explain.length === 0) {
    throw new PipelineError('来源校验失败：解释陈述缺乏证据支撑，已全部剔除');
  }

  // 8. 版本号：该 episode 现有最大 version + 1
  const maxVer = db.prepare(`SELECT MAX(version) AS v FROM analysis WHERE episode_id=?`).get(episodeId) as
    | { v: number | null }
    | undefined;
  const version = (maxVer?.v ?? 0) + 1;

  // 9. 检索快照（策略 + 命中的证据文档 + 被剔除陈述；快照来自 evidence 模块的检索服务）
  const retrievalSnapshot = {
    ...outcome.retrieval_snapshot,
    strategy: modelRelease.retrieval_strategy ?? outcome.retrieval_snapshot.strategy ?? RETRIEVAL_STRATEGY,
    removed_statements: removed,
  };

  const generatedAt = now();
  const safetyFlag = payload.safety_flag ?? 'none';
  const meta = {
    model_release: `${modelRelease.model_name} ${modelRelease.prompt_version}`,
    model_release_id: modelRelease.id,
    prompt_version: modelRelease.prompt_version,
    content_lib_version: modelRelease.content_lib_version,
    retrieval_strategy: modelRelease.retrieval_strategy,
    retrieval_snapshot: retrievalSnapshot,
    generated_at: generatedAt,
    version,
    safety_flag: safetyFlag,
    disclaimer: `系统生成内容（v${version}），仅供参考，不作诊断`,
  };
  const fullSections: AnalysisSections & { meta: typeof meta } = { ...sections, meta };

  // 10. 保存 analysis + citation（事务）
  const analysisId = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO analysis (id, episode_id, version, model_release_id, sections, retrieval_snapshot, safety_flag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      analysisId,
      episodeId,
      version,
      modelRelease.id,
      JSON.stringify(fullSections),
      JSON.stringify(retrievalSnapshot),
      safetyFlag,
      generatedAt,
    );
    const insertCit = db.prepare(
      `INSERT INTO analysis_citation (id, analysis_id, evidence_doc_id, statement, supported) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const stmt of sections.explain) {
      for (const c of stmt.citations) {
        insertCit.run(randomUUID(), analysisId, c.evidence_doc_id, c.statement, c.supported ? 1 : 0);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 事务可能已自动回滚
    }
    throw e;
  }
  return analysisId;
}

/** 构建检索 Query：病程事件 + 报告原文 + 症状记录 + 本次提交文本 */
function buildQuery(db: DatabaseSync, episodeId: string, payload: TaskPayload): string {
  const parts: string[] = [];
  const events = db
    .prepare(`SELECT raw_text FROM care_event WHERE episode_id=? AND raw_text IS NOT NULL`)
    .all(episodeId) as { raw_text: string }[];
  for (const e of events) parts.push(e.raw_text);
  const reports = db
    .prepare(
      `SELECT r.raw_text FROM report r JOIN care_event c ON c.id=r.care_event_id WHERE c.episode_id=? AND r.raw_text IS NOT NULL`,
    )
    .all(episodeId) as { raw_text: string }[];
  for (const r of reports) parts.push(r.raw_text);
  const logs = db
    .prepare(
      `SELECT s.top_worry FROM symptom_log s JOIN care_event c ON c.id=s.care_event_id
       WHERE c.episode_id=? AND s.top_worry IS NOT NULL`,
    )
    .all(episodeId) as { top_worry: string }[];
  for (const l of logs) parts.push(l.top_worry);
  const t = payload.texts ?? {};
  for (const v of [t.symptom_change, t.report_text, t.question]) {
    if (v && v.trim()) parts.push(v);
  }
  return parts.join(' ');
}

/** 已知段：把病程事件整理为带来源 / 时间 / 核实状态 / care_event_id 的条目 */
function buildKnown(db: DatabaseSync, episodeId: string): KnownItem[] {
  const events = db
    .prepare(`SELECT * FROM care_event WHERE episode_id=? ORDER BY occurred_at ASC, rowid ASC`)
    .all(episodeId) as {
    id: string;
    event_type: string;
    occurred_at: string;
    source_type: string;
    raw_text: string | null;
    verify_status: string;
  }[];
  return events.map((e) => ({
    text: `${beijingDate(e.occurred_at)} ${e.raw_text?.trim() || `（${e.event_type}，无原文）`}（${e.source_type}，${e.verify_status}）`,
    source: e.source_type,
    occurred_at: e.occurred_at,
    verify_status: e.verify_status,
    care_event_id: e.id,
  }));
}

/** 候选视频：已发布且未下线的视频内容 */
function buildVideoCandidates(db: DatabaseSync): VideoItem[] {
  const rows = db
    .prepare(
      `SELECT id, title FROM content_item
       WHERE type='视频' AND current_status='已发布' AND offline_switch=0
       ORDER BY created_at DESC LIMIT 2`,
    )
    .all() as { id: string; title: string }[];
  return rows.map((r) => ({
    content_item_id: r.id,
    title: r.title,
    reason: '与你当前情况相关的已审核科普视频',
  }));
}

/** 上下文：用于「未知」段判断缺失信息（不补写概率） */
function buildContext(db: DatabaseSync, episodeId: string, payload: TaskPayload): GenerateContext {
  const ep = db.prepare(`SELECT title FROM episode WHERE id=?`).get(episodeId) as
    | { title: string }
    | undefined;
  const log = db
    .prepare(
      `SELECT s.leg_change FROM symptom_log s JOIN care_event c ON c.id=s.care_event_id
       WHERE c.episode_id=? ORDER BY c.occurred_at DESC, c.rowid DESC LIMIT 1`,
    )
    .get(episodeId) as { leg_change: string } | undefined;
  const reports = db
    .prepare(
      `SELECT r.raw_text FROM report r JOIN care_event c ON c.id=r.care_event_id WHERE c.episode_id=?`,
    )
    .all(episodeId) as { raw_text: string }[];
  const reportText = reports.map((r) => r.raw_text ?? '').join(' ');
  // 去掉「未描述 / 未提及 …」后再判断是否真正描述了下肢肌力
  const withoutNegation = reportText.replace(/未(描述|提及|检查|包括|见)[^。；，,.!?]{0,12}/g, '');
  const report_describes_leg = /肌力|下肢.{0,4}(力|感觉|麻木)/.test(withoutNegation);
  return {
    episode_title: ep?.title ?? '',
    leg_change: log?.leg_change ?? null,
    report_describes_leg,
    question: payload.texts?.question,
  };
}

function switchEnabled(db: DatabaseSync, key: string): boolean {
  const row = db.prepare(`SELECT enabled FROM feature_switch WHERE key=?`).get(key) as
    | { enabled: number }
    | undefined;
  if (row) return row.enabled === 1;
  // 与 SwitchesService 的默认值保持一致
  return key === '个性化分析' || key === '视频推荐';
}
