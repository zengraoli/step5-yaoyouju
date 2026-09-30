import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { currentRequestId } from './request-context';

/**
 * 审计日志（只追加、不可改）。
 * 哈希链：hash = sha256(prev_hash + 本次记录关键字段），B11 提供校验。
 *
 * 完整性保护（验收反馈第 37 条）：
 * 1. 每条记录带自增 seq（1..N 连续），删除任意一条都会出现断号；
 * 2. 每次追加同步更新「链头锚点」audit_anchor（head_hash + total），
 *    只删尾记录不会破坏哈希链，但会让锚点与链头不一致，从而被发现；
 * 3. request_id 参与哈希，改一个字符链就断。
 */
@Injectable()
export class AuditService {
  /** 事务嵌套深度：业务方法自身可能已开事务，这里只在最外层开 */
  private sp = 0;

  constructor(private readonly db: DbService) {}

  private lastHash(): string {
    const row = this.db.app
      .prepare('SELECT hash FROM audit_log ORDER BY rowid DESC LIMIT 1')
      .get() as { hash: string | null } | undefined;
    return row?.hash ?? 'GENESIS';
  }

  /** 追加一条审计记录 */
  append(actorId: string | null, action: string, target: string, diff: unknown, requestId?: string): void {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const diffText = diff === undefined ? null : JSON.stringify(diff);
    const prevHash = this.lastHash();
    const rid = requestId ?? currentRequestId();
    const hash = createHash('sha256')
      .update([prevHash, id, actorId ?? '', action, target ?? '', diffText ?? '', createdAt, rid ?? ''].join('|'))
      .digest('hex');
    const sp = this.begin();
    try {
      const seq =
        ((this.db.app.prepare('SELECT MAX(seq) AS m FROM audit_log').get() as { m: number | null }).m ?? 0) + 1;
      this.db.app
        .prepare(
          `INSERT INTO audit_log (id, actor_id, action, target, diff, request_id, prev_hash, hash, seq, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, actorId, action, target, diffText, rid ?? null, prevHash, hash, seq, createdAt);
      const total = (this.db.app.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
      this.db.app
        .prepare(
          `INSERT INTO audit_anchor (id, head_hash, total) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET head_hash = excluded.head_hash, total = excluded.total`,
        )
        .run(hash, total);
      this.commit(sp);
    } catch (err) {
      this.rollback(sp);
      throw err;
    }
  }

  /** 校验哈希链是否完整（B11）：链 + 连续性 + 链头锚点 */
  verifyChain(): { ok: boolean; broken_at: string | null; reason?: string } {
    const rows = this.db.app
      .prepare(
        'SELECT id, actor_id, action, target, diff, request_id, seq, prev_hash, hash, created_at FROM audit_log ORDER BY rowid ASC',
      )
      .all() as {
      id: string;
      actor_id: string | null;
      action: string;
      target: string | null;
      diff: string | null;
      request_id: string | null;
      seq: number | null;
      prev_hash: string | null;
      hash: string | null;
      created_at: string;
    }[];
    let prev = 'GENESIS';
    let expectedSeq = 1;
    for (const r of rows) {
      if (r.seq !== expectedSeq) {
        return { ok: false, broken_at: r.id, reason: `审计记录不连续（第 ${expectedSeq} 条缺失或被删除）` };
      }
      if (r.prev_hash !== prev) return { ok: false, broken_at: r.id, reason: '前向哈希不匹配' };
      const hash = createHash('sha256')
        .update(
          [
            prev,
            r.id,
            r.actor_id ?? '',
            r.action,
            r.target ?? '',
            r.diff ?? '',
            r.created_at,
            r.request_id ?? '',
          ].join('|'),
        )
        .digest('hex');
      if (hash !== r.hash) return { ok: false, broken_at: r.id, reason: '记录内容被篡改' };
      prev = hash;
      expectedSeq += 1;
    }
    const anchor = this.db.app
      .prepare('SELECT head_hash, total FROM audit_anchor WHERE id = 1')
      .get() as { head_hash: string; total: number } | undefined;
    if (!anchor) {
      return { ok: false, broken_at: null, reason: '缺少链头锚点，无法证明审计未被删减' };
    }
    const last = rows[rows.length - 1];
    if (!last || last.hash !== anchor.head_hash) {
      return { ok: false, broken_at: null, reason: '链头与锚点不一致，可能存在被删除的审计记录' };
    }
    if (anchor.total !== rows.length) {
      return { ok: false, broken_at: null, reason: '审计记录数量与锚点不一致，可能存在被删除的审计记录' };
    }
    return { ok: true, broken_at: null };
  }

  /** 事务辅助：用 SAVEPOINT 包裹写入，既能与业务事务合并，也能单独生效 */
  private begin(): string {
    const name = `audit_sp_${(this.sp += 1)}`;
    this.db.app.exec(`SAVEPOINT ${name}`);
    return name;
  }

  private commit(name: string): void {
    this.db.app.exec(`RELEASE ${name}`);
  }

  private rollback(name: string): void {
    try {
      this.db.app.exec(`ROLLBACK TO ${name}`);
      this.db.app.exec(`RELEASE ${name}`);
    } catch {
      // 已回滚
    }
  }
}
