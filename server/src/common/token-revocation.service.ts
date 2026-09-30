import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { DbService } from '../db/db.service';

/**
 * 令牌吊销表（验收反馈第 5 条：退出登录后旧令牌必须失效）。
 * 用户端与后台令牌都是无状态签名，退出登录时把「令牌哈希」写入黑名单，
 * verifyToken 命中黑名单即视为无效（过期后可清理）。
 */
@Injectable()
export class TokenRevocationService {
  private readonly app: DatabaseSync;

  constructor(db: DbService) {
    this.app = db.app;
    this.app.exec(`
      CREATE TABLE IF NOT EXISTS revoked_token (
        key        TEXT PRIMARY KEY,
        kind       TEXT NOT NULL DEFAULT 'user',
        expires_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  static hashOf(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 吊销一个令牌；expiresAt 用于清理（可空） */
  revoke(token: string, kind: 'user' | 'admin' = 'user', expiresAt?: string | null): void {
    const key = TokenRevocationService.hashOf(token);
    const now = new Date().toISOString();
    this.app
      .prepare(
        `INSERT INTO revoked_token (key, kind, expires_at, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO NOTHING`,
      )
      .run(key, kind, expiresAt ?? null, now);
  }

  isRevoked(token: string): boolean {
    const key = TokenRevocationService.hashOf(token);
    const row = this.app.prepare('SELECT key FROM revoked_token WHERE key = ?').get(key) as
      | { key: string }
      | undefined;
    return Boolean(row);
  }

  /** 清理已过期的黑名单记录（令牌本身已过期，留着没有意义） */
  cleanup(): number {
    const now = new Date().toISOString();
    const res = this.app
      .prepare('DELETE FROM revoked_token WHERE expires_at IS NOT NULL AND expires_at < ?')
      .run(now) as { changes?: number };
    return res.changes ?? 0;
  }
}
