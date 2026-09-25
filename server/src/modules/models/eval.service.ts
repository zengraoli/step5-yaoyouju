import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import {
  EVAL_CATEGORIES,
  EvalCase,
  EvalMetrics,
  FailedCase,
  REQUIRED_EVAL_SETS,
  evalResult,
  scoreCases,
} from './eval-scorer';

/** 评测运行结果（docs/system-design.md 第 3 节 EVAL_RUN.result） */
export const EVAL_RESULTS = ['通过', '阻断发布'] as const;

/** 单个用例的输入上限（演示数据，防止超长文本） */
const MAX_CASE_LEN = 500;
const MAX_CASES = 50;

export interface EvalSetItem {
  id: string;
  name: string;
  case_count: number;
  deidentified: boolean;
  /** 最近一次运行结果（该评测集） */
  latest_run: { id: string; result: string; created_at: string; model_release_id: string } | null;
}

export interface EvalRunItem {
  id: string;
  model_release_id: string;
  model_name: string;
  prompt_version: string;
  eval_set_id: string;
  eval_set_name: string;
  result: string;
  metrics: EvalMetrics;
  trigger_reason: string;
  case_count: number;
  passed_count: number;
  failed_count: number;
  /** 失败用例（输入 / 期望 / 实际 / 判定，已去标识化） */
  failed_cases: FailedCase[];
  created_at: string;
}

export interface CreateEvalSetInput {
  name: string;
  cases: EvalCase[];
}

export interface GateStatus {
  passed: boolean;
  /** 尚未运行的必需评测集 */
  missing: string[];
  /** 最近一次运行未通过的必需评测集 */
  blocked: string[];
}

/**
 * 评测集与运行（B09，T13）。
 *
 * - listSets / createSet：评测集列表与新建（演示用例，deidentified=true）；
 * - runEval：本地模拟评分器逐用例「生成 + 核对」，输出 metrics 与失败用例（去标识化）；
 * - listRuns / getRun：运行记录与详情；
 * - gateStatus：发布门禁——该发布最新一次覆盖全部必需评测集的运行是否通过
 *   （任一类别失败数 > 0 → 阻断发布，产品红线）。
 */
@Injectable()
export class EvalService {
  private readonly logger = new Logger('Eval');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** 评测集列表：名称、用例数、是否去标识化、最近一次运行结果 */
  listSets(): EvalSetItem[] {
    const rows = this.db.app
      .prepare('SELECT id, name, case_count, deidentified FROM eval_set ORDER BY rowid ASC')
      .all() as { id: string; name: string; case_count: number; deidentified: number }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      case_count: r.case_count,
      deidentified: r.deidentified === 1,
      latest_run: this.latestRunOfSet(r.id),
    }));
  }

  /** 新建评测集（演示用例；失败用例对外输出去标识化） */
  createSet(input: CreateEvalSetInput, actorId: string | null): EvalSetItem {
    const name = (input.name ?? '').trim();
    if (!name) throw new ApiException(ErrorCode.BAD_REQUEST, '评测集名称不能为空');
    if (name.length > 50) throw new ApiException(ErrorCode.BAD_REQUEST, '评测集名称不能超过 50 个字符');
    const cases = this.validateCases(input.cases);

    const id = randomUUID();
    this.db.app
      .prepare('INSERT INTO eval_set (id, name, case_count, deidentified, cases) VALUES (?, ?, ?, 1, ?)')
      .run(id, name, cases.length, JSON.stringify(cases));
    this.audit.append(actorId, 'eval_set.create', `eval_set:${id}`, { name, case_count: cases.length });
    this.logger.log(`[eval] 新建评测集 ${name}（${cases.length} 个用例）`);
    return { id, name, case_count: cases.length, deidentified: true, latest_run: null };
  }

  /**
   * 运行评测：对每个用例做「生成 + 核对」（本地模拟评分器，不调用外部服务）。
   * result 由 metrics 决定：任一类别失败数 > 0 → 阻断发布。
   */
  runEval(
    modelReleaseId: string,
    evalSetId: string,
    triggerReason?: string,
    actorId: string | null = null,
  ): EvalRunItem {
    const release = this.db.app
      .prepare('SELECT id, model_name, prompt_version FROM model_release WHERE id=?')
      .get(modelReleaseId) as { id: string; model_name: string; prompt_version: string } | undefined;
    if (!release) throw new ApiException(ErrorCode.NOT_FOUND, '模型发布不存在');

    const set = this.db.app
      .prepare('SELECT id, name, cases FROM eval_set WHERE id=?')
      .get(evalSetId) as { id: string; name: string; cases: string | null } | undefined;
    if (!set) throw new ApiException(ErrorCode.NOT_FOUND, '评测集不存在');

    const cases = this.parseCases(set.cases);
    if (cases.length === 0) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '评测集没有用例，无法运行评测');
    }

    const { metrics, failed, passed } = scoreCases(cases);
    const result = evalResult(failed.length);
    const reason = (triggerReason ?? '').trim() || '手动触发';
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.app
      .prepare(
        `INSERT INTO eval_run (id, model_release_id, eval_set_id, metrics, result, trigger_reason, failed_cases, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        release.id,
        set.id,
        JSON.stringify(metrics),
        result,
        reason,
        JSON.stringify(failed),
        createdAt,
      );
    this.audit.append(actorId, 'eval_run.run', `eval_run:${id}`, {
      model_release_id: release.id,
      eval_set_id: set.id,
      eval_set_name: set.name,
      result,
      metrics,
      trigger_reason: reason,
    });
    this.logger.log(
      `[eval] ${release.model_name} ${release.prompt_version} × ${set.name} → ${result}（${passed}/${cases.length} 通过，原因：${reason}）`,
    );
    return {
      id,
      model_release_id: release.id,
      model_name: release.model_name,
      prompt_version: release.prompt_version,
      eval_set_id: set.id,
      eval_set_name: set.name,
      result,
      metrics,
      trigger_reason: reason,
      case_count: cases.length,
      passed_count: passed,
      failed_count: failed.length,
      failed_cases: failed,
      created_at: createdAt,
    };
  }

  /** 运行记录：触发原因、时间、指标、结果（可按评测集筛选） */
  listRuns(evalSetId?: string): EvalRunItem[] {
    const sql = evalSetId
      ? `SELECT r.*, m.model_name, m.prompt_version, s.name AS eval_set_name
         FROM eval_run r
         JOIN model_release m ON m.id = r.model_release_id
         JOIN eval_set s ON s.id = r.eval_set_id
         WHERE r.eval_set_id = ?
         ORDER BY r.created_at DESC, r.rowid DESC`
      : `SELECT r.*, m.model_name, m.prompt_version, s.name AS eval_set_name
         FROM eval_run r
         JOIN model_release m ON m.id = r.model_release_id
         JOIN eval_set s ON s.id = r.eval_set_id
         ORDER BY r.created_at DESC, r.rowid DESC`;
    const rows = (
      evalSetId ? this.db.app.prepare(sql).all(evalSetId) : this.db.app.prepare(sql).all()
    ) as EvalRunRowWithNames[];
    return rows.map((r) => this.toItem(r));
  }

  /** 运行详情（含失败用例） */
  getRun(id: string): EvalRunItem {
    const row = this.db.app
      .prepare(
        `SELECT r.*, m.model_name, m.prompt_version, s.name AS eval_set_name
         FROM eval_run r
         JOIN model_release m ON m.id = r.model_release_id
         JOIN eval_set s ON s.id = r.eval_set_id
         WHERE r.id = ?`,
      )
      .get(id) as EvalRunRowWithNames | undefined;
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND, '评测运行不存在');
    return this.toItem(row);
  }

  /**
   * 门禁状态：该发布对每个必需评测集的「最新一次」运行是否通过。
   * 任一必需评测集缺少运行或最近一次未通过 → 门禁未通过（阻断生效）。
   */
  gateStatus(modelReleaseId: string): GateStatus {
    const missing: string[] = [];
    const blocked: string[] = [];
    for (const name of REQUIRED_EVAL_SETS) {
      const row = this.db.app
        .prepare(
          `SELECT r.result AS result FROM eval_run r
           JOIN eval_set s ON s.id = r.eval_set_id
           WHERE r.model_release_id = ? AND s.name = ?
           ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`,
        )
        .get(modelReleaseId, name) as { result: string } | undefined;
      if (!row) missing.push(name);
      else if (row.result !== '通过') blocked.push(name);
    }
    return { passed: missing.length === 0 && blocked.length === 0, missing, blocked };
  }

  // ---------- 内部 ----------

  private latestRunOfSet(evalSetId: string): EvalSetItem['latest_run'] {
    const row = this.db.app
      .prepare(
        `SELECT id, result, created_at, model_release_id FROM eval_run
         WHERE eval_set_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(evalSetId) as { id: string; result: string; created_at: string; model_release_id: string } | undefined;
    return row ?? null;
  }

  /** 校验演示用例：类别必须在四类之内，输入 / 期望 / 输出必填且不超长 */
  private validateCases(cases: unknown): EvalCase[] {
    if (!Array.isArray(cases) || cases.length === 0) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '评测集至少需要 1 个演示用例');
    }
    if (cases.length > MAX_CASES) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `单个评测集最多 ${MAX_CASES} 个用例`);
    }
    return cases.map((c, i) => {
      const item = (c ?? {}) as Partial<EvalCase>;
      const category = String(item.category ?? '').trim();
      if (!EVAL_CATEGORIES.includes(category as (typeof EVAL_CATEGORIES)[number])) {
        throw new ApiException(ErrorCode.BAD_REQUEST, `第 ${i + 1} 个用例的类别必须是：${EVAL_CATEGORIES.join(' / ')}`);
      }
      const input = String(item.input ?? '').trim();
      const expected = String(item.expected ?? '').trim();
      const actual = String(item.actual ?? '').trim();
      for (const [field, value] of [
        ['输入', input],
        ['期望', expected],
        ['输出', actual],
      ] as [string, string][]) {
        if (!value) throw new ApiException(ErrorCode.BAD_REQUEST, `第 ${i + 1} 个用例的${field}不能为空`);
        if (value.length > MAX_CASE_LEN) {
          throw new ApiException(ErrorCode.BAD_REQUEST, `第 ${i + 1} 个用例的${field}不能超过 ${MAX_CASE_LEN} 个字符`);
        }
      }
      return { category, input, expected, actual };
    });
  }

  private parseCases(raw: string | null): EvalCase[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as EvalCase[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private toItem(row: EvalRunRowWithNames): EvalRunItem {
    const metrics = row.metrics ? (JSON.parse(row.metrics) as EvalMetrics) : emptyMetrics();
    const failed = row.failed_cases ? (JSON.parse(row.failed_cases) as FailedCase[]) : [];
    const caseCount = metrics.用例总数 ?? 0;
    return {
      id: row.id,
      model_release_id: row.model_release_id,
      model_name: row.model_name,
      prompt_version: row.prompt_version,
      eval_set_id: row.eval_set_id,
      eval_set_name: row.eval_set_name,
      result: row.result,
      metrics,
      trigger_reason: row.trigger_reason ?? '',
      case_count: caseCount,
      passed_count: Math.max(caseCount - failed.length, 0),
      failed_count: failed.length,
      failed_cases: failed,
      created_at: row.created_at,
    };
  }
}

type EvalRunRow = {
  id: string;
  model_release_id: string;
  eval_set_id: string;
  metrics: string | null;
  result: string;
  trigger_reason: string | null;
  failed_cases: string | null;
  created_at: string;
};

type EvalRunRowWithNames = EvalRunRow & { model_name: string; prompt_version: string; eval_set_name: string };

function emptyMetrics(): EvalMetrics {
  return { 错误安慰: 0, 关键遗漏: 0, 左右侧混淆: 0, 隐私: 0, 用例总数: 0, 用例通过率: 0 };
}
