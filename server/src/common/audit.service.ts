import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';

/**
 * 审计日志（只追加、不可改）。
 * 哈希链：hash = sha256(prev_hash + 本次记录关键字段），B11 提供校验。
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  private lastHash(): string {
    const row = this.db.app
      .prepare('SELECT hash FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get() as { hash: string | null } | undefined;
    return row?.hash ?? 'GENESIS';
  }

  /** 追加一条审计记录 */
  append(actorId: string | null, action: string, target: string, diff: unknown, requestId?: string): void {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const diffText = diff === undefined ? null : JSON.stringify(diff);
    const prevHash = this.lastHash();
    const hash = createHash('sha256')
      .update([prevHash, id, actorId ?? '', action, target, diffText ?? '', createdAt].join('|'))
      .digest('hex');
    this.db.app
      .prepare(
        `INSERT INTO audit_log (id, actor_id, action, target, diff, request_id, prev_hash, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, actorId, action, target, diffText, requestId ?? null, prevHash, hash, createdAt);
  }

  /** 校验哈希链是否完整（B11） */
  verifyChain(): { ok: boolean; brokenAt?: string } {
    const rows = this.db.app
      .prepare('SELECT id, actor_id, action, target, diff, created_at, prev_hash, hash FROM audit_log ORDER BY created_at ASC, rowid ASC')
      .all() as {
      id: string;
      actor_id: string | null;
      action: string;
      target: string | null;
      diff: string | null;
      created_at: string;
      prev_hash: string | null;
      hash: string | null;
    }[];
    let prev = 'GENESIS';
    for (const r of rows) {
      if (r.prev_hash !== prev) return { ok: false, brokenAt: r.id };
      const hash = createHash('sha256')
        .update([prev, r.id, r.actor_id ?? '', r.action, r.target ?? '', r.diff ?? '', r.created_at].join('|'))
        .digest('hex');
      if (hash !== r.hash) return { ok: false, brokenAt: r.id };
      prev = hash;
    }
    return { ok: true };
  }
}
