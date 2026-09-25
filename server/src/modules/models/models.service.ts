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
  created_at: string;
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

  /** 发布组合表：模型名、提示词版本、检索策略、内容库版本、状态、创建时间、最近评测结果 */
  list(): ReleaseItem[] {
    const rows = this.db.app
      .prepare(
        `SELECT id, model_name, prompt_version, retrieval_strategy, content_lib_version, status, created_at
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
    if (row.status === '已回滚') {
      throw new ApiException(ErrorCode.CONFLICT, '已回滚的发布不能重新提升');
    }

    // 评测门禁：走向生效前必须全部必需评测集的最近一次运行通过
    const gate = this.evalService.gateStatus(id);
    if (!gate.passed) {
      throw new ApiException(ErrorCode.CONFLICT, gateBlockedMessage(gate));
    }

    const to = row.status === '候选' ? '灰度' : '生效';
    this.db.app.prepare('UPDATE model_release SET status=? WHERE id=?').run(to, id);

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

  /** 回滚：灰度 / 生效 / 候选 → 已回滚（必须填写原因） */
  rollback(id: string, reason: string, actorId: string | null): ReleaseItem {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new ApiException(ErrorCode.BAD_REQUEST, '回滚原因不能为空');
    if (trimmed.length > 500) throw new ApiException(ErrorCode.BAD_REQUEST, '回滚原因不能超过 500 个字符');

    const row = this.require(id);
    if (row.status === '已回滚') {
      throw new ApiException(ErrorCode.CONFLICT, '该发布已回滚，无需重复回滚');
    }

    this.db.app.prepare(`UPDATE model_release SET status='已回滚' WHERE id=?`).run(id);
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
        `SELECT id, model_name, prompt_version, retrieval_strategy, content_lib_version, status, created_at
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
      created_at: row.created_at,
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
