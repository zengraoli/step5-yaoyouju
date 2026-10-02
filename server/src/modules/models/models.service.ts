import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { ApiException, ErrorCode } from '../../common/api-error';
import { EvalService, GateStatus } from './eval.service';

/** 发布状态（docs/system-design.md 第 3 节 MODEL_RELEASE.status + 演示流程的「候选」） */
export const RELEASE_STATUSES = ['候选', '灰度', '生效', '已回滚'] as const;

/** 最近一次评测结果（发布组合表用） */
export interface LatestEval {
  id: string;
  eval_set_id: string;
  eval_set_name: string;
  result: string;
  created_at: string;
}

export interface ReleaseItem {
  id: string;
  model_name: string;
  prompt_version: string;
  retrieval_strategy: string | null;
  content_lib_version: string | null;
  status: string;
  /** 灰度流量（百分比：候选 0 / 灰度 10 / 生效 100 / 已回滚 0） */
  gray_traffic: number;
  created_at: string;
  /** 向量 / embedding 模型版本（演示实现：与检索策略一致的本地向量） */
  embedding: string;
  latest_eval: LatestEval | null;
  /** 门禁状态：是否已覆盖全部必需评测集且最近一次均通过 */
  gate: GateStatus;
}

export interface CreateReleaseInput {
  model_name: string;
  prompt_version: string;
  retrieval_strategy?: string;
  content_lib_version?: string;
}

type ReleaseRow = {
  id: string;
  model_name: string;
  prompt_version: string;
  retrieval_strategy: string | null;
  content_lib_version: string | null;
  status: string;
  gray_traffic?: number;
  created_at: string;
};

/**
 * 模型发布组合管理（B08，T13）。
 *
 * 发布流程：候选 →（评测门禁）→ 灰度 → 生效，可回滚到已回滚。
 * - create：创建候选发布（状态=候选）；
 * - promote：提升一级（候选→灰度→生效），提升前必须通过评测门禁
 *   （该发布最新一次覆盖全部必需评测集的运行均为「通过」），否则 40900；
 * - 生效中的发布被新发布顶替时自动变为已回滚（写审计）；
 * - rollback：显式回滚（必须填写原因，写审计）；
 * - 每次状态流转都写 audit_log（只追加 + 哈希链）。
 */
@Injectable()
export class ModelReleasesService {
  private readonly logger = new Logger('ModelRelease');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly evalService: EvalService,
  ) {}

  /** 组合标识（确认单展示用）：模型名 + 提示词版本 */
  labelOf(id: string): string {
    const row = this.db.app
      .prepare('SELECT model_name, prompt_version FROM model_release WHERE id = ?')
      .get(id) as { model_name: string; prompt_version: string } | undefined;
    if (!row) return '模型发布';
    return `${row.model_name} ${row.prompt_version}`;
  }

  /** 发布组合表：模型名、提示词版本、检索策略、内容库版本、状态、创建时间、最近评测结果 */
  list(): ReleaseItem[] {
    const rows = this.db.app
      .prepare(
        `SELECT id, model_name, prompt_version, retrieval_strategy, content_lib_version, status, gray_traffic, created_at
         FROM model_release ORDER BY created_at DESC, rowid DESC`,
      )
      .all() as ReleaseRow[];
    return rows.map((r) => this.toItem(r));
  }

  /** 创建候选发布（状态=候选） */
  create(input: CreateReleaseInput, actorId: string | null): ReleaseItem {
    const modelName = (input.model_name ?? '').trim();
    const promptVersion = (input.prompt_version ?? '').trim();
    if (!modelName) throw new ApiException(ErrorCode.BAD_REQUEST, '模型名称不能为空');
    if (!promptVersion) throw new ApiException(ErrorCode.BAD_REQUEST, '提示词版本不能为空');
    if (modelName.length > 50) throw new ApiException(ErrorCode.BAD_REQUEST, '模型名称不能超过 50 个字符');
    if (promptVersion.length > 50) throw new ApiException(ErrorCode.BAD_REQUEST, '提示词版本不能超过 50 个字符');
    const retrieval = (input.retrieval_strategy ?? '').trim() || null;
    const contentLib = (input.content_lib_version ?? '').trim() || null;

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.app
      .prepare(
        `INSERT INTO model_release (id, model_name, prompt_version, retrieval_strategy, content_lib_version, status, created_at)
         VALUES (?, ?, ?, ?, ?, '候选', ?)`,
      )
      .run(id, modelName, promptVersion, retrieval, contentLib, createdAt);
    this.audit.append(actorId, 'model_release.create', `model_release:${id}`, {
      model_name: modelName,
      prompt_version: promptVersion,
      retrieval_strategy: retrieval,
      content_lib_version: contentLib,
      status: '候选',
    });
    this.logger.log(`[model_release] 创建候选发布 ${modelName} ${promptVersion}（${id}）`);
    return this.toItem({
      id,
      model_name: modelName,
      prompt_version: promptVersion,
      retrieval_strategy: retrieval,
      content_lib_version: contentLib,
      status: '候选',
      created_at: createdAt,
    });
  }

  /**
   * 提升一级：候选 → 灰度 → 生效。
   * 产品红线：门禁未通过则阻断发布——提升前必须存在该发布的通过评测运行，
   * 且覆盖全部必需评测集（任一类别失败数 > 0 → 阻断发布），否则 40900。
   */
  promote(id: string, actorId: string | null): ReleaseItem {
    const row = this.require(id);
    if (row.status === '生效') {
      throw new ApiException(ErrorCode.CONFLICT, '该发布已生效，无需提升');
    }
    // 已回滚的发布允许重新提升（验收反馈：原生效版本被新版本顶替后要能回到上一版），
    // 但仍必须先通过评测门禁。

    // 评测门禁：走向生效前必须全部必需评测集的最近一次运行通过
    const gate = this.evalService.gateStatus(id);
    if (!gate.passed) {
      throw new ApiException(ErrorCode.CONFLICT, gateBlockedMessage(gate));
    }

    const to = row.status === '候选' ? '灰度' : '生效';
    const traffic = to === '灰度' ? 10 : 100;
    this.db.app.prepare('UPDATE model_release SET status=?, gray_traffic=? WHERE id=?').run(to, traffic, id);

    if (to === '生效') {
      // 顶替：原「生效」发布自动回滚（演示流程中同一时刻只有一个生效发布）
      const previous = this.db.app
        .prepare(`SELECT id FROM model_release WHERE status='生效' AND id<>?`)
        .all(id) as { id: string }[];
      for (const p of previous) {
        this.db.app.prepare(`UPDATE model_release SET status='已回滚' WHERE id=?`).run(p.id);
        this.audit.append(actorId, 'model_release.auto_rollback', `model_release:${p.id}`, {
          from: '生效',
          to: '已回滚',
          reason: '被新发布顶替',
          replaced_by: id,
        });
      }
    }

    this.audit.append(actorId, 'model_release.promote', `model_release:${id}`, {
      from: row.status,
      to,
      gate: { missing: gate.missing, blocked: gate.blocked },
    });
    this.logger.log(`[model_release] ${id} 状态流转 ${row.status} → ${to}`);
    return this.toItem({ ...row, status: to });
  }

  /** 是否是唯一生效的发布（回滚它会让新分析全部失败；控制器据此先拦下来） */
  isLastActive(id: string): boolean {
    const row = this.require(id);
    if (row.status !== '生效') return false;
    const others = this.db.app
      .prepare(`SELECT id FROM model_release WHERE status='生效' AND id<>?`)
      .all(id) as { id: string }[];
    return others.length === 0;
  }

  /** 是否存在另一个「已过评测门禁」的发布可以在当前生效发布回滚后顶上 */
  hasRollbackFallback(id: string): boolean {
    const rows = this.db.app
      .prepare(`SELECT id FROM model_release WHERE status<>'已回滚' AND id<>?`)
      .all(id) as { id: string }[];
    return rows.some((r) => this.evalService.gateStatus(r.id).passed);
  }

  /** 发布门禁状态（控制器在校验双人确认前先看门禁，避免无意义的确认单） */
  gateStatusOf(id: string): GateStatus {
    this.require(id);
    return this.evalService.gateStatus(id);
  }

  /** 回滚：灰度 / 生效 / 候选 → 已回滚（必须填写原因） */
  rollback(id: string, reason: string, actorId: string | null): ReleaseItem {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new ApiException(ErrorCode.BAD_REQUEST, '回滚原因不能为空');
    if (trimmed.length > 500) throw new ApiException(ErrorCode.BAD_REQUEST, '回滚原因不能超过 500 个字符');

    const row = this.require(id);
    if (row.status === '已回滚') {
      throw new ApiException(ErrorCode.CONFLICT, '该发布已回滚，无需重复回滚');
    }
    // 回滚唯一生效的发布会让新分析全部失败：必须先有另一个「已过门禁」的发布可以顶上
    if (row.status === '生效') {
      const others = this.db.app
        .prepare(`SELECT id FROM model_release WHERE status='生效' AND id<>?`)
        .all(id) as { id: string }[];
      if (others.length === 0) {
        const fallback = this.db.app
          .prepare(`SELECT id FROM model_release WHERE status<>'已回滚' AND id<>?`)
          .all(id) as { id: string }[];
        const ready = fallback.find((f) => this.evalService.gateStatus(f.id).passed);
        if (!ready) {
          throw new ApiException(
            ErrorCode.CONFLICT,
            '这是唯一生效的发布，回滚后新分析会全部失败；请先把另一个通过评测门禁的发布提升为生效后再回滚',
          );
        }
        this.logger.warn(
          `[model_release] 回滚唯一生效发布 ${id}，系统内已存在通过门禁的发布 ${ready.id} 可顶上`,
        );
      }
    }

    this.db.app.prepare(`UPDATE model_release SET status='已回滚', gray_traffic=0 WHERE id=?`).run(id);
    this.audit.append(actorId, 'model_release.rollback', `model_release:${id}`, {
      from: row.status,
      to: '已回滚',
      reason: trimmed,
    });
    this.logger.log(`[model_release] ${id} 已回滚（${trimmed}）`);
    return this.toItem({ ...row, status: '已回滚' });
  }

  // ---------- 内部 ----------

  private require(id: string): ReleaseRow {
    const row = this.db.app
      .prepare(
        `SELECT id, model_name, prompt_version, retrieval_strategy, content_lib_version, status, gray_traffic, created_at
         FROM model_release WHERE id=?`,
      )
      .get(id) as ReleaseRow | undefined;
    if (!row) throw new ApiException(ErrorCode.NOT_FOUND, '模型发布不存在');
    return row;
  }

  private toItem(row: ReleaseRow): ReleaseItem {
    return {
      id: row.id,
      model_name: row.model_name,
      prompt_version: row.prompt_version,
      retrieval_strategy: row.retrieval_strategy,
      content_lib_version: row.content_lib_version,
      status: row.status,
      gray_traffic: Number(row.gray_traffic ?? 0),
      created_at: row.created_at,
      embedding: `local-16d（${row.model_name} ${row.prompt_version}）`,
      latest_eval: this.latestEval(row.id),
      gate: this.evalService.gateStatus(row.id),
    };
  }

  /** 最近一次评测结果（跨全部评测集，按时间倒序） */
  private latestEval(releaseId: string): LatestEval | null {
    const row = this.db.app
      .prepare(
        `SELECT r.id, r.eval_set_id, r.result, r.created_at, s.name AS eval_set_name
         FROM eval_run r JOIN eval_set s ON s.id = r.eval_set_id
         WHERE r.model_release_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`,
      )
      .get(releaseId) as LatestEval | undefined;
    return row ?? null;
  }
}

/** 门禁未通过的中文说明（40900） */
function gateBlockedMessage(gate: GateStatus): string {
  const parts: string[] = [];
  if (gate.missing.length > 0) parts.push(`缺少必需评测集（${gate.missing.join('、')}）`);
  if (gate.blocked.length > 0) parts.push(`最近一次评测未通过（${gate.blocked.join('、')}）`);
  return `评测门禁未通过，不能生效：${parts.join('；')}`;
}
