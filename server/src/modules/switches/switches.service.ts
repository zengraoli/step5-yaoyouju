import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { ApiException, ErrorCode } from '../../common/api-error';

export const SWITCH_KEYS = ['个性化分析', '视频推荐', '拍照提取', '案例卡片'] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];

/** 数据库中无记录时的默认值 */
const SWITCH_DEFAULTS: Record<SwitchKey, boolean> = {
  个性化分析: true,
  视频推荐: true,
  拍照提取: false,
  案例卡片: false,
};

export interface SwitchState {
  key: SwitchKey;
  enabled: boolean;
  reason: string | null;
  updated_at: string;
}

/**
 * 功能开关：立即生效（客户端读取 /switches，服务端每次请求实时判断）。
 * 变更写审计日志（只追加 + 哈希链）。
 */
@Injectable()
export class SwitchesService {
  private readonly logger = new Logger('Switches');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list(): SwitchState[] {
    const rows = this.db.app
      .prepare('SELECT key, enabled, reason, updated_at FROM feature_switch')
      .all() as { key: string; enabled: number; reason: string | null; updated_at: string }[];
    const map = new Map(rows.map((r) => [r.key as SwitchKey, r]));
    return SWITCH_KEYS.map((key) => {
      const r = map.get(key);
      return {
        key,
        enabled: r ? r.enabled === 1 : SWITCH_DEFAULTS[key],
        reason: r?.reason ?? null,
        updated_at: r?.updated_at ?? '',
      };
    });
  }

  isEnabled(key: string): boolean {
    const row = this.db.app
      .prepare('SELECT enabled FROM feature_switch WHERE key = ?')
      .get(key) as { enabled: number } | undefined;
    if (row) return row.enabled === 1;
    return SWITCH_DEFAULTS[key as SwitchKey] ?? false;
  }

  /** 变更开关：立即生效 + 写审计 */
  setEnabled(key: string, enabled: boolean, reason: string, actorId: string | null): SwitchState[] {
    if (!SWITCH_KEYS.includes(key as SwitchKey)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `开关名称必须是：${SWITCH_KEYS.join(' / ')}`);
    }
    const now = new Date().toISOString();
    const existing = this.db.app
      .prepare('SELECT id FROM feature_switch WHERE key = ?')
      .get(key) as { id: string } | undefined;
    if (existing) {
      this.db.app
        .prepare('UPDATE feature_switch SET enabled = ?, reason = ?, updated_at = ? WHERE key = ?')
        .run(enabled ? 1 : 0, reason, now, key);
    } else {
      this.db.app
        .prepare('INSERT INTO feature_switch (id, key, enabled, reason, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), key, enabled ? 1 : 0, reason, now);
    }
    this.audit.append(actorId, 'switch.update', `feature_switch:${key}`, {
      key,
      enabled,
      reason,
    });
    this.logger.log(`[switch] ${key} → ${enabled ? '开启' : '关闭'}（${reason}）`);
    return this.list();
  }
}
