import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { SafetyService, SafetyResult } from '../safety/safety.service';
import { SwitchesService } from '../switches/switches.service';
import { buildFallbackSections, FallbackEvent, FallbackSections } from './fallback';

/** 就医提示内容（参照 SafetyNoticeController.emergencyNotice 结构，附带命中的 matched 规则） */
export interface SafetyNotice {
  title: string;
  headline: string;
  body: string;
  matched: {
    rule_code: string;
    label: string;
    severity: string;
    action: string;
    advice: string;
    excerpt: string;
  }[];
  actions: { type: string; label: string }[];
  bring_list: string[];
  footer_note: string;
  rule_set_version: string;
}

export interface CreateAnalysisInput {
  episode_id: string;
  symptom_change?: string;
  report_text?: string;
  question?: string;
}

export type CreateAnalysisResult =
  | { status: 'queued'; task_id: string; safety_notice: SafetyNotice | null }
  | { status: 'fallback'; fallback: FallbackSections; safety_notice: SafetyNotice | null };

/**
 * 分析编排服务（/analyses，RAG + 安全流程，docs/system-design.md 第 5 节）。
 * POST 先做红旗与服务范围校验，命中 high 不建任务直接返回就医提示；
 * 命中 medium 建任务并附提示；个性化分析开关关闭时返回回退结果；
 * 通过后创建排队任务，返回 202 + 任务 ID。Worker 另见 analysis-pipeline.ts。
 */
@Injectable()
export class AnalysesService {
  private readonly logger = new Logger('Analyses');

  constructor(
    private readonly db: DbService,
    private readonly safety: SafetyService,
    private readonly switches: SwitchesService,
    private readonly audit: AuditService,
  ) {}

  /** 提交分析：红旗校验 → 开关判断 → 创建排队任务 / 回退 */
  create(userId: string, input: CreateAnalysisInput): CreateAnalysisResult {
    const ep = this.ownedEpisode(userId, input.episode_id);

    // 1. 安全规则引擎：对本次提交的结构化文本（症状变化 / 报告原文 / 提问）校验红旗
    const texts = [input.symptom_change, input.report_text, input.question].filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0,
    );
    const result = this.safety.checkRedFlags({ user_id: userId, texts });

    // 2. 命中 high（停止个性化）→ 不创建任务，返回就医提示（40911，由控制器抛错）
    if (result.safety_flag === 'stop_personal') {
      const notice = this.buildNotice(result);
      const high = result.matched.find((m) => m.severity === 'high') ?? result.matched[0];
      throw new ApiException(ErrorCode.SAFETY_STOP_PERSONAL, high?.advice, notice);
    }

    const safetyNotice = result.safety_flag === 'seek_care' ? this.buildNotice(result) : null;

    // 3. 个性化分析开关关闭 → 返回回退结果，不创建任务
    if (!this.switches.isEnabled('个性化分析')) {
      const fallback = buildFallbackSections({
        episode_title: ep.title as string,
        events: this.episodeEvents(ep.id as string),
        reason: 'switch_off',
      });
      this.logger.log(`[analysis] 个性化分析开关关闭，返回回退结果（episode ${ep.id}）`);
      return { status: 'fallback', fallback, safety_notice: safetyNotice };
    }

    // 4. 通过：创建排队任务（medium 命中也建任务并附提示）
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const payload = {
      episode_id: ep.id,
      texts: {
        symptom_change: input.symptom_change,
        report_text: input.report_text,
        question: input.question,
      },
      safety_flag: result.safety_flag,
      matched: result.matched.map((m) => ({
        rule_code: m.rule_code,
        label: m.label,
        severity: m.severity,
      })),
    };
    this.db.app
      .prepare(
        `INSERT INTO analysis_task (id, episode_id, user_id, payload, status, attempts, safety_flag, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .run(taskId, ep.id as string, userId, JSON.stringify(payload), result.safety_flag, now, now);
    this.audit.append(userId, 'analysis.create_task', `analysis_task:${taskId}`, {
      episode_id: ep.id,
      safety_flag: result.safety_flag,
    });
    this.logger.log(`[analysis] 创建分析任务 ${taskId}（episode ${ep.id}，safety=${result.safety_flag}）`);
    return { status: 'queued', task_id: taskId, safety_notice: safetyNotice };
  }

  /** 查询任务状态与结果：排队中 / 完成（分析）/ 失败（回退 + 原因） */
  getTask(userId: string, taskId: string) {
    const task = this.db.app.prepare(`SELECT * FROM analysis_task WHERE id=?`).get(taskId) as
      | {
          id: string;
          episode_id: string;
          user_id: string;
          status: string;
          attempts: number;
          result_analysis_id: string | null;
          error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!task || task.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '分析任务不存在');
    }
    if (task.status === 'completed' && task.result_analysis_id) {
      return {
        status: 'completed',
        task_id: task.id,
        analysis: this.loadAnalysis(task.result_analysis_id),
      };
    }
    if (task.status === 'failed') {
      const title = this.episodeTitle(task.episode_id);
      const fallback = buildFallbackSections({
        episode_title: title,
        events: this.episodeEvents(task.episode_id),
        reason: 'service_unavailable',
      });
      return { status: 'failed', task_id: task.id, reason: task.error ?? '分析失败', fallback };
    }
    // queued（或重试中）
    return { status: 'queued', task_id: task.id, attempts: task.attempts };
  }

  /** 一页分析详情：五段结构 + 每条解释的来源 + meta（模型版本 / 检索快照 / disclaimer） */
  get(userId: string, analysisId: string) {
    const row = this.db.app
      .prepare(
        `SELECT a.*, e.user_id FROM analysis a JOIN episode e ON e.id = a.episode_id WHERE a.id = ?`,
      )
      .get(analysisId) as Record<string, unknown> | undefined;
    if (!row || row.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '分析不存在');
    }
    return this.loadAnalysis(analysisId)!;
  }

  /** 某病程最新一页分析（version 最大）；没有则返回 null */
  latestForEpisode(userId: string, episodeId: string) {
    const owned = this.db.app
      .prepare('SELECT id FROM episode WHERE id = ? AND user_id = ?')
      .get(episodeId, userId) as { id: string } | undefined;
    if (!owned) {
      throw new ApiException(ErrorCode.NOT_FOUND, '病程不存在');
    }
    const row = this.db.app
      .prepare(
        `SELECT id FROM analysis WHERE episode_id = ? ORDER BY version DESC, created_at DESC LIMIT 1`,
      )
      .get(episodeId) as { id: string } | undefined;
    return row ? this.loadAnalysis(row.id) : null;
  }

  // ---------- 内部 ----------

  private loadAnalysis(analysisId: string) {
    const row = this.db.app.prepare(`SELECT * FROM analysis WHERE id=?`).get(analysisId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const sections = row.sections ? JSON.parse(row.sections as string) : null;
    const retrieval = row.retrieval_snapshot ? JSON.parse(row.retrieval_snapshot as string) : null;
    return {
      id: row.id,
      episode_id: row.episode_id,
      version: row.version,
      model_release_id: row.model_release_id,
      safety_flag: row.safety_flag,
      created_at: row.created_at,
      sections,
      retrieval_snapshot: retrieval,
      disclaimer: sections?.meta?.disclaimer ?? '系统生成内容，仅供参考，不作诊断',
    };
  }

  private buildNotice(result: SafetyResult): SafetyNotice {
    const high = result.matched.find((m) => m.severity === 'high');
    const labels = result.matched.map((m) => m.label);
    return {
      title: '需要及时寻求专业帮助',
      headline: high ? '建议尽快就医' : '建议及时就医评估',
      body: high
        ? `你提交的内容包含需要尽快就医的信号：${labels.join('、')}。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。`
        : `你提交的内容包含建议及时就医的信号：${labels.join('、')}。这类变化建议由医生评估，个性化分析仍会生成，但请以医生的评估为准。`,
      matched: result.matched.map((m) => ({
        rule_code: m.rule_code,
        label: m.label,
        severity: m.severity,
        action: m.action,
        advice: m.advice,
        excerpt: m.excerpt,
      })),
      actions: [
        { type: 'call', label: '拨打 120 / 前往急诊' },
        { type: 'hospital', label: '查找附近医院' },
        { type: 'doctor', label: '联系我的主治医生（已保存）' },
      ],
      bring_list: [
        '已录入的检查报告原文',
        '症状开始时间与最近变化记录',
        '正在使用的药物与既有医嘱',
      ],
      footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
      rule_set_version: result.rule_set_version,
    };
  }

  private episodeEvents(episodeId: string): FallbackEvent[] {
    const rows = this.db.app
      .prepare(
        `SELECT event_type, source_type, raw_text, occurred_at, verify_status
         FROM care_event WHERE episode_id=? ORDER BY occurred_at ASC, rowid ASC`,
      )
      .all(episodeId) as {
      event_type: string;
      source_type: string;
      raw_text: string | null;
      occurred_at: string;
      verify_status: string;
    }[];
    return rows.map((r) => ({
      event_type: r.event_type,
      source_type: r.source_type,
      raw_text: r.raw_text,
      occurred_at: r.occurred_at,
      verify_status: r.verify_status,
    }));
  }

  private episodeTitle(episodeId: string): string {
    const ep = this.db.app.prepare(`SELECT title FROM episode WHERE id=?`).get(episodeId) as
      | { title: string }
      | undefined;
    return ep?.title ?? '';
  }

  private ownedEpisode(userId: string, episodeId: string) {
    const ep = this.db.app.prepare(`SELECT * FROM episode WHERE id=?`).get(episodeId) as
      | Record<string, unknown>
      | undefined;
    if (!ep || ep.user_id !== userId) {
      throw new ApiException(ErrorCode.NOT_FOUND, '病程不存在');
    }
    return ep;
  }
}
