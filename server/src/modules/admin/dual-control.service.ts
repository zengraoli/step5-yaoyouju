import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { DbService } from '../../db/db.service';

/**
 * 双人确认（T14，B03 批量下线 / B04 双人发布 / B10 设置）。
 * 设置存放在 feature_switch（key = 发布双人确认），默认开启，与内容发布流程
 * 「审核人与发布人不能是同一人」的内置规则一致；变更写审计日志（只追加）。
 * check() 供内容发布、批量下线等高风险操作复用（T10 发布流程已内置双人确认，保持兼容）。
 */
export const DUAL_CONTROL_KEY = '发布双人确认';

export interface DualControlSettings {
  key: string;
  enabled: boolean;
  reason: string | null;
  updated_at: string;
}

export interface DualControlCheckResult {
  action: string;
  /** 开关是否开启（开启时相关操作必须双人确认） */
  required: boolean;
  /** 是否已满足双人确认（操作之外的另一账号已确认） */
  confirmed: boolean;
  /** 确认人（如内容发布的临床审核人） */
  confirmed_by: string | null;
  /** 未满足时的中文说明（供调用方直接作为 40900 文案） */
  message: string | null;
}

@Injectable()
export class DualControlService {
  private readonly logger = new Logger('DualControl');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** 当前设置（无记录时默认开启） */
  getSettings(): DualControlSettings {
    const row = this.db.app
      .prepare('SELECT key, enabled, reason, updated_at FROM feature_switch WHERE key = ?')
      .get(DUAL_CONTROL_KEY) as { key: string; enabled: number; reason: string | null; updated_at: string } | undefined;
    return {
      key: DUAL_CONTROL_KEY,
      enabled: row ? row.enabled === 1 : true,
      reason: row?.reason ?? null,
      updated_at: row?.updated_at ?? '',
    };
  }

  /** 开启 / 关闭双人确认（写审计） */
  updateSettings(enabled: boolean, reason: string, actorId: string): DualControlSettings {
    const text = (reason ?? '').trim();
    if (!text) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请填写变更原因');
    }
    const now = new Date().toISOString();
    const existing = this.db.app
      .prepare('SELECT id FROM feature_switch WHERE key = ?')
      .get(DUAL_CONTROL_KEY) as { id: string } | undefined;
    if (existing) {
      this.db.app
        .prepare('UPDATE feature_switch SET enabled = ?, reason = ?, updated_at = ? WHERE key = ?')
        .run(enabled ? 1 : 0, text, now, DUAL_CONTROL_KEY);
    } else {
      this.db.app
        .prepare('INSERT INTO feature_switch (id, key, enabled, reason, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), DUAL_CONTROL_KEY, enabled ? 1 : 0, text, now);
    }
    this.audit.append(actorId, 'dual_control.update', `feature_switch:${DUAL_CONTROL_KEY}`, {
      key: DUAL_CONTROL_KEY,
      enabled,
      reason: text,
    });
    this.logger.log(`[dual-control] 双人确认 → ${enabled ? '开启' : '关闭'}（${text}）`);
    return this.getSettings();
  }

  /**
   * 双人确认校验：actorId 对 targetId 执行 action 是否已满足双人确认。
   * - content.publish：以目标上最近一条「通过」的审核记录为确认人，确认人与操作人不能相同；
   * - 其他高风险操作（如批量下线）：需要操作之外的另一账号复核（confirmed=false 时由调用方阻止）。
   */
  check(actorId: string | null, targetId: string, action: string): DualControlCheckResult {
    const required = this.getSettings().enabled;
    if (action === 'content.publish') {
      const approver = this.db.app
        .prepare(
          `SELECT reviewer_id FROM review_record
           WHERE target_id = ? AND decision = '通过' AND reviewer_id IS NOT NULL
           ORDER BY reviewed_at DESC, rowid DESC LIMIT 1`,
        )
        .get(targetId) as { reviewer_id: string } | undefined;
      const confirmedBy = approver?.reviewer_id ?? null;
      const confirmed = !!confirmedBy && confirmedBy !== actorId;
      return {
        action,
        required,
        confirmed,
        confirmed_by: confirmedBy,
        message: confirmed
          ? null
          : '发布需双人确认：审核人与发布人不能是同一人，请换一位临床审核角色发布',
      };
    }
    return {
      action,
      required,
      confirmed: false,
      confirmed_by: null,
      message: required ? '该操作需要双人确认：请由另一名具备权限的账号复核后执行' : null,
    };
  }

  /** 便捷方法：未满足双人确认时直接抛出 40900（供发布、批量下线等操作复用） */
  ensureConfirmed(actorId: string | null, targetId: string, action: string): DualControlCheckResult {
    const result = this.check(actorId, targetId, action);
    if (result.required && !result.confirmed) {
      throw new ApiException(ErrorCode.CONFLICT, result.message ?? '该操作需要双人确认');
    }
    return result;
  }
}
