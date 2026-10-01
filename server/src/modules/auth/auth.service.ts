import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { ApiException, ErrorCode } from '../../common/api-error';
import { FieldCrypto } from '../../db/crypto.service';
import { DbService } from '../../db/db.service';
import { TokenRevocationService } from '../../common/token-revocation.service';

function safeEqualPhone(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 删除账户相关提示统一用北京时间展示 */
function beijingTime(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

export const CONSENT_SCOPES = ['健康信息处理', '分享', '产品改进'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export interface AuthUser {
  id: string;
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const DELETE_COOLING_MS = 24 * 60 * 60 * 1000; // 删除账户冷静期 24 小时
const MAX_CODE_FAILS = 5; // 验证码连续输错上限
const LOCK_MS = 15 * 60 * 1000; // 达到上限后锁定时长

interface AttemptState {
  fails: number;
  lockedUntil: number;
}

/** 用户数据导出结构（演示实现：JSON 全文导出） */
export interface AccountExport {
  exported_at: string;
  user: { id: string; created_at: string; phone_masked: string };
  consents: unknown[];
  episodes: unknown[];
  analyses: unknown[];
  followup_summaries: unknown[];
  followup_questions: unknown[];
  qa_sessions: unknown[];
  feedback: unknown[];
  safety_events: unknown[];
  note: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly secret: string;
  /** 登录 / 删除确认的尝试记录：手机号 → { 失败次数, 锁定截止 } */
  private readonly attempts = new Map<string, AttemptState>();

  constructor(
    private readonly db: DbService,
    private readonly revocation: TokenRevocationService,
  ) {
    this.secret =
      process.env.AUTH_TOKEN_SECRET?.trim() ||
      this.db.crypto.blindIndex('auth-token-secret').slice(0, 32); // 演示用派生密钥，生产必须配置环境变量
  }

  private get app(): DatabaseSync {
    return this.db.app;
  }

  private get identity(): DatabaseSync {
    return this.db.identity;
  }

  private get crypto(): FieldCrypto {
    return this.db.crypto;
  }

  /** 发送验证码：演示实现固定验证码，只写日志（手机号脱敏） */
  sendCode(phone: string): { sent: boolean; masked: string } {
    this.assertPhone(phone);
    const masked = FieldCrypto.maskPhone(phone);
    this.logger.log(`[sms] 演示验证码已发送至 ${masked}（验证码为演示固定值，不在日志中记录）`);
    return { sent: true, masked };
  }

  /** 手机号 + 验证码登录；任意 11 位手机号首次登录自动创建用户 */
  login(phone: string, code: string) {
    this.assertPhone(phone);
    this.assertNotLocked(phone);
    const demoCode = process.env.DEMO_SMS_CODE ?? '123456';
    if (code !== demoCode) {
      this.recordFailure(phone);
      throw new ApiException(ErrorCode.BAD_REQUEST, '验证码不正确，请重新输入');
    }
    const profile = this.identity
      .prepare('SELECT user_id FROM identity_profile WHERE phone_hash = ?')
      .get(this.crypto.blindIndex(phone)) as { user_id: string } | undefined;
    let user = profile
      ? (this.app.prepare('SELECT id, status FROM users WHERE id = ?').get(profile.user_id) as
          | { id: string; status: string }
          | undefined)
      : undefined;
    if (!user) {
      user = this.createUser(phone);
    }
    if (user.status !== 'active') {
      throw new ApiException(ErrorCode.FORBIDDEN, '账号状态异常，请联系支持');
    }
    this.attempts.delete(phone);
    this.logger.log(`[auth] 登录成功 ${FieldCrypto.maskPhone(phone)}`);
    return {
      token: this.issueToken(user.id),
      user: { id: user.id, phone_masked: FieldCrypto.maskPhone(phone) },
      consents: this.listConsents(user.id),
    };
  }

  /** 退出登录：吊销当前令牌（旧令牌立即失效） */
  logout(token: string): { ok: true } {
    if (!token) throw new ApiException(ErrorCode.UNAUTHORIZED, '请先登录');
    this.revocation.revoke(token, 'user', new Date(Date.now() + TOKEN_TTL_MS).toISOString());
    this.logger.log('[auth] 用户退出登录，令牌已吊销');
    return { ok: true };
  }

  private createUser(phone: string): { id: string; status: string } {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.app
      .prepare('INSERT INTO users (id, status, created_at) VALUES (?, ?, ?)')
      .run(id, 'active', now);
    this.identity
      .prepare(
        'INSERT INTO identity_profile (user_id, phone_enc, phone_hash, real_name_enc) VALUES (?, ?, ?, ?)',
      )
      .run(id, this.crypto.encrypt(phone), this.crypto.blindIndex(phone), null);
    return { id, status: 'active' };
  }

  issueToken(userId: string): string {
    const iat = Date.now();
    const exp = iat + TOKEN_TTL_MS;
    const payload = `${userId}.${exp}.${iat}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `v1.${Buffer.from(payload).toString('base64url')}.${sig}`;
  }

  /** 校验令牌，返回用户 ID；无效 / 已吊销返回 null */
  verifyToken(token: string): AuthUser | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const given = Buffer.from(parts[2] ?? '');
    if (given.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(expected), given)) return null;
    const [userId, expRaw, iatRaw] = payload.split('.');
    const exp = Number(expRaw);
    const iat = Number(iatRaw);
    if (!userId || !Number.isFinite(exp) || exp < Date.now()) return null;
    if (this.revocation.isRevoked(token)) return null;
    if (Number.isFinite(iat) && this.revocation.isAccountRevoked(userId, iat)) return null;
    const user = this.app.prepare('SELECT id, status FROM users WHERE id = ?').get(userId) as
      | { id: string; status: string }
      | undefined;
    if (!user || user.status !== 'active') return null;
    return { id: user.id };
  }

  me(userId: string) {
    const row = this.app.prepare('SELECT id, created_at FROM users WHERE id = ?').get(userId) as {
      id: string;
      created_at: string;
    };
    const profile = this.identity
      .prepare('SELECT phone_enc, real_name_enc FROM identity_profile WHERE user_id = ?')
      .get(userId) as { phone_enc: string; real_name_enc: string | null } | undefined;
    const phone = profile ? this.crypto.decrypt(profile.phone_enc) : '';
    return {
      id: row.id,
      phone_masked: FieldCrypto.maskPhone(phone),
      real_name_masked: profile?.real_name_enc ? '已填写' : null,
      created_at: row.created_at,
      consents: this.listConsents(userId),
      deletion: this.deletionStatus(userId),
    };
  }

  listConsents(userId: string) {
    const rows = this.app
      .prepare(
        `SELECT id, scope, granted_at, revoked_at FROM consent
         WHERE user_id = ? ORDER BY granted_at ASC`,
      )
      .all(userId) as { id: string; scope: string; granted_at: string; revoked_at: string | null }[];
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) latest.set(r.scope, r);
    return [...latest.values()].map((r) => ({
      id: r.id,
      scope: r.scope,
      granted: !r.revoked_at,
      granted_at: r.granted_at,
      revoked_at: r.revoked_at,
    }));
  }

  hasConsent(userId: string, scope: ConsentScope): boolean {
    const row = this.app
      .prepare(
        `SELECT COUNT(*) AS n FROM consent
         WHERE user_id = ? AND scope = ? AND revoked_at IS NULL`,
      )
      .get(userId, scope) as { n: number };
    return row.n > 0;
  }

  /** 是否曾经同意过该范围（撤回后仍可只读查看历史数据） */
  everConsented(userId: string, scope: ConsentScope): boolean {
    const row = this.app
      .prepare(`SELECT COUNT(*) AS n FROM consent WHERE user_id = ? AND scope = ?`)
      .get(userId, scope) as { n: number };
    return row.n > 0;
  }

  /** 同意：可查、可撤回；重复同意不产生多条有效记录 */
  grantConsent(userId: string, scope: string) {
    this.assertScope(scope);
    if (this.hasConsent(userId, scope as ConsentScope)) {
      return this.listConsents(userId);
    }
    this.app
      .prepare('INSERT INTO consent (id, user_id, scope, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), userId, scope, new Date().toISOString(), null);
    this.logger.log(`[consent] 用户 ${userId.slice(0, 8)}… 同意「${scope}」`);
    return this.listConsents(userId);
  }

  /** 撤回同意：立即生效（后续接口按无同意拒绝） */
  revokeConsent(userId: string, scope: string) {
    this.assertScope(scope);
    const now = new Date().toISOString();
    this.app
      .prepare(
        `UPDATE consent SET revoked_at = ?
         WHERE user_id = ? AND scope = ? AND revoked_at IS NULL`,
      )
      .run(now, userId, scope);
    this.logger.log(`[consent] 用户 ${userId.slice(0, 8)}… 撤回「${scope}」`);
    return this.listConsents(userId);
  }

  // ---------- 导出与删除（验收反馈第 4 条） ----------

  /** 我的数据导出（JSON 全文：病程、记录、分析、问答、反馈、安全事件） */
  exportData(userId: string): AccountExport {
    const user = this.app.prepare('SELECT id, created_at FROM users WHERE id = ?').get(userId) as {
      id: string;
      created_at: string;
    };
    const profile = this.identity
      .prepare('SELECT phone_enc FROM identity_profile WHERE user_id = ?')
      .get(userId) as { phone_enc: string } | undefined;
    const phone = profile ? this.crypto.decrypt(profile.phone_enc) : '';
    return {
      exported_at: new Date().toISOString(),
      user: { id: userId, created_at: user.created_at, phone_masked: FieldCrypto.maskPhone(phone) },
      consents: this.listConsents(userId),
      episodes: this.app
        .prepare(
          `SELECT e.id, e.title, e.onset_date, e.onset_certainty, e.status, e.created_at,
                  (SELECT json_group_array(json_object(
                     'id', c.id, 'event_type', c.event_type, 'occurred_at', c.occurred_at,
                     'source_type', c.source_type, 'raw_text', c.raw_text, 'verify_status', c.verify_status))
                   FROM care_event c WHERE c.episode_id = e.id) AS events
           FROM episode e WHERE e.user_id = ? ORDER BY e.created_at ASC`,
        )
        .all(userId),
      qa_sessions: this.app
        .prepare(
          `SELECT s.id, s.episode_id, s.created_at,
                  (SELECT json_group_array(json_object(
                     'role', m.role, 'content', m.content, 'refused', m.refused,
                     'followup_question', m.followup_question, 'created_at', m.created_at))
                   FROM qa_message m WHERE m.session_id = s.id) AS messages
           FROM qa_session s WHERE s.user_id = ? ORDER BY s.created_at ASC`,
        )
        .all(userId),
      analyses: this.app
        .prepare(
          `SELECT a.id, a.version, a.safety_flag, a.created_at, a.sections, a.retrieval_snapshot
           FROM analysis a JOIN episode e ON e.id = a.episode_id WHERE e.user_id = ? ORDER BY a.created_at ASC`,
        )
        .all(userId),
      followup_summaries: this.app
        .prepare(
          `SELECT f.id, f.episode_id, f.content, f.export_format, f.exported_at
           FROM followup_summary f JOIN episode e ON e.id = f.episode_id WHERE e.user_id = ? ORDER BY f.rowid ASC`,
        )
        .all(userId),
      followup_questions: this.app
        .prepare(
          `SELECT q.id, q.episode_id, q.question, q.created_at
           FROM followup_question q JOIN episode e ON e.id = q.episode_id WHERE e.user_id = ? ORDER BY q.created_at ASC`,
        )
        .all(userId),
      feedback: this.app
        .prepare('SELECT id, help_type, unsolved_question, is_error_report, category, description, status, created_at FROM feedback WHERE user_id = ?')
        .all(userId),
      safety_events: this.app
        .prepare('SELECT id, rule_code, severity, action_taken, created_at FROM safety_event WHERE user_id = ?')
        .all(userId),
      note: '本文件为你的个人数据导出（演示实现），包含已录入的病程、报告、分析、复诊摘要、复诊问题与问答记录。',
    };
  }

  /** 申请删除账户：验证码二次确认 → 24 小时冷静期（手机号必须是本人） */
  requestDeletion(userId: string, code: string, phone: string) {
    this.assertPhone(phone);
    this.assertOwnPhone(userId, phone);
    this.assertNotLocked(`del:${phone}`);
    const demoCode = process.env.DEMO_SMS_CODE ?? '123456';
    if (code !== demoCode) {
      this.recordFailure(`del:${phone}`);
      throw new ApiException(ErrorCode.BAD_REQUEST, '验证码不正确，请重新输入');
    }
    this.attempts.delete(`del:${phone}`);
    const existing = this.app
      .prepare(`SELECT * FROM deletion_request WHERE user_id = ? AND status = '冷静期中' ORDER BY requested_at DESC LIMIT 1`)
      .get(userId) as { id: string } | undefined;
    if (existing) {
      return this.deletionStatus(userId)!;
    }
    const id = randomUUID();
    const now = new Date();
    this.app
      .prepare(
        `INSERT INTO deletion_request (id, user_id, scope, status, requested_at, effective_at)
         VALUES (?, ?, ?, '冷静期中', ?, ?)`,
      )
      .run(id, userId, '全部数据', now.toISOString(), new Date(now.getTime() + DELETE_COOLING_MS).toISOString());
    this.logger.log(`[auth] 用户 ${userId.slice(0, 8)}… 申请删除账户，进入 24 小时冷静期`);
    return this.deletionStatus(userId)!;
  }

  /** 冷静期结束后确认删除：硬删全部个人数据（不可恢复） */
  confirmDeletion(userId: string, code: string, phone: string): { deleted: boolean; removed: Record<string, number> } {
    this.assertPhone(phone);
    this.assertOwnPhone(userId, phone);
    this.assertNotLocked(`del:${phone}`);
    const demoCode = process.env.DEMO_SMS_CODE ?? '123456';
    if (code !== demoCode) {
      this.recordFailure(`del:${phone}`);
      throw new ApiException(ErrorCode.BAD_REQUEST, '验证码不正确，请重新输入');
    }
    const req = this.app
      .prepare(`SELECT * FROM deletion_request WHERE user_id = ? AND status = '冷静期中' ORDER BY requested_at DESC LIMIT 1`)
      .get(userId) as { id: string; effective_at: string } | undefined;
    if (!req) {
      throw new ApiException(ErrorCode.CONFLICT, '还没有删除申请，请先提交删除申请');
    }
    if (new Date(req.effective_at).getTime() > Date.now()) {
      throw new ApiException(
        ErrorCode.CONFLICT,
        `还在冷静期内（${beijingTime(req.effective_at)} 之后才能确认删除），可以取消删除`,
      );
    }
    this.attempts.delete(`del:${phone}`);
    const removed = this.purgeUserData(userId);
    const now = new Date().toISOString();
    this.app.prepare(`UPDATE deletion_request SET status = '已执行', executed_at = ? WHERE id = ?`).run(now, req.id);
    // 删除后该账号不可再登录：users.status 置为 deleted，identity 一并清除
    this.app.prepare('DELETE FROM users WHERE id = ?').run(userId);
    this.identity.prepare('DELETE FROM identity_profile WHERE user_id = ?').run(userId);
    this.logger.log(`[auth] 用户 ${userId.slice(0, 8)}… 已确认删除账户并清除数据`);
    return { deleted: true, removed };
  }

  /** 取消删除申请 */
  cancelDeletion(userId: string): { cancelled: boolean } {
    const now = new Date().toISOString();
    this.app
      .prepare(`UPDATE deletion_request SET status = '已取消', cancelled_at = ? WHERE user_id = ? AND status = '冷静期中'`)
      .run(now, userId);
    return { cancelled: true };
  }

  /** 当前删除申请状态（没有则返回 null） */
  deletionStatus(userId: string) {
    const row = this.app
      .prepare('SELECT * FROM deletion_request WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1')
      .get(userId) as
      | { id: string; status: string; requested_at: string; effective_at: string; executed_at: string | null }
      | undefined;
    if (!row) return null;
    return {
      status: row.status,
      requested_at: row.requested_at,
      effective_at: row.effective_at,
      executed_at: row.executed_at,
      can_confirm: row.status === '冷静期中' && new Date(row.effective_at).getTime() <= Date.now(),
    };
  }

  /** 硬删该用户的全部业务数据（外键关联表一并清理） */
  private purgeUserData(userId: string): Record<string, number> {
    const summary = [
      'DELETE FROM qa_message WHERE session_id IN (SELECT id FROM qa_session WHERE user_id = ?)',
      'DELETE FROM qa_session WHERE user_id = ?',
      'DELETE FROM followup_question WHERE episode_id IN (SELECT id FROM episode WHERE user_id = ?)',
      'DELETE FROM feedback_handling WHERE feedback_id IN (SELECT id FROM feedback WHERE user_id = ?)',
      'DELETE FROM analysis_citation WHERE analysis_id IN (SELECT id FROM analysis WHERE episode_id IN (SELECT id FROM episode WHERE user_id = ?))',
      'DELETE FROM analysis WHERE episode_id IN (SELECT id FROM episode WHERE user_id = ?)',
      'DELETE FROM analysis_task WHERE user_id = ?',
      'DELETE FROM symptom_log WHERE care_event_id IN (SELECT id FROM care_event WHERE episode_id IN (SELECT id FROM episode WHERE user_id = ?))',
      'DELETE FROM report WHERE care_event_id IN (SELECT id FROM care_event WHERE episode_id IN (SELECT id FROM episode WHERE user_id = ?))',
      'DELETE FROM care_event WHERE episode_id IN (SELECT id FROM episode WHERE user_id = ?)',
      'DELETE FROM followup_summary WHERE episode_id IN (SELECT id FROM episode WHERE user_id = ?)',
      'DELETE FROM episode WHERE user_id = ?',
      'DELETE FROM feedback WHERE user_id = ?',
      'DELETE FROM case_submission WHERE user_id = ?',
      'DELETE FROM safety_event WHERE user_id = ?',
      'DELETE FROM consent WHERE user_id = ?',
      'DELETE FROM deletion_request WHERE user_id = ?',
    ];
    const removed: Record<string, number> = {};
    this.app.exec('BEGIN IMMEDIATE');
    try {
      for (const sql of summary) {
        const table = /DELETE FROM (\w+)/.exec(sql)![1];
        const res = this.app.prepare(sql).run(userId) as { changes?: number };
        removed[table] = res.changes ?? 0;
      }
      this.app.exec('COMMIT');
    } catch (err) {
      try {
        this.app.exec('ROLLBACK');
      } catch {
        // 已回滚
      }
      throw err;
    }
    return removed;
  }

  /** 手机号必须是当前登录用户本人（删除申请 / 确认删除都按本人核对） */
  private assertOwnPhone(userId: string, phone: string): void {
    const row = this.identity
      .prepare('SELECT phone_enc FROM identity_profile WHERE user_id = ?')
      .get(userId) as { phone_enc: string } | undefined;
    const own = row ? this.crypto.decrypt(row.phone_enc) : '';
    if (!safeEqualPhone(own, phone)) {
      throw new ApiException(ErrorCode.FORBIDDEN, '手机号与当前登录账号不一致，请使用本账号绑定的手机号');
    }
  }

  private assertScope(scope: string): void {
    if (!CONSENT_SCOPES.includes(scope as ConsentScope)) {
      throw new ApiException(ErrorCode.BAD_REQUEST, `同意范围必须是：${CONSENT_SCOPES.join(' / ')}`);
    }
  }

  private assertPhone(phone: string): void {
    if (!/^1\d{10}$/.test(phone ?? '')) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请输入正确的 11 位手机号');
    }
  }

  private assertNotLocked(key: string): void {
    const state = this.attempts.get(key);
    if (state && state.lockedUntil > Date.now()) {
      throw new ApiException(ErrorCode.FORBIDDEN, '尝试次数过多，请 15 分钟后再试');
    }
  }

  private recordFailure(key: string): void {
    const prev = this.attempts.get(key);
    const fails = (prev?.fails ?? 0) + 1;
    const lockedUntil = fails >= MAX_CODE_FAILS ? Date.now() + LOCK_MS : (prev?.lockedUntil ?? 0);
    this.attempts.set(key, { fails, lockedUntil });
    if (lockedUntil > Date.now()) {
      this.logger.warn(`[auth] ${key} 验证码连续输错 ${fails} 次，已临时锁定 15 分钟`);
    }
  }
}
