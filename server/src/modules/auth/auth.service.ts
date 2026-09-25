import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { ApiException, ErrorCode } from '../../common/api-error';
import { FieldCrypto } from '../../db/crypto.service';
import { DbService } from '../../db/db.service';

export const CONSENT_SCOPES = ['健康信息处理', '分享', '产品改进'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export interface AuthUser {
  id: string;
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly secret: string;

  constructor(private readonly db: DbService) {
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
    const demoCode = process.env.DEMO_SMS_CODE ?? '123456';
    if (code !== demoCode) {
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
    this.logger.log(`[auth] 登录成功 ${FieldCrypto.maskPhone(phone)}`);
    return {
      token: this.issueToken(user.id),
      user: { id: user.id, phone_masked: FieldCrypto.maskPhone(phone) },
      consents: this.listConsents(user.id),
    };
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
    const exp = Date.now() + TOKEN_TTL_MS;
    const payload = `${userId}.${exp}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `v1.${Buffer.from(payload).toString('base64url')}.${sig}`;
  }

  /** 校验令牌，返回用户 ID；无效返回 null */
  verifyToken(token: string): AuthUser | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
    const [userId, expRaw] = payload.split('.');
    const exp = Number(expRaw);
    if (!userId || !Number.isFinite(exp) || exp < Date.now()) return null;
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
    };
  }

  listConsents(userId: string) {    const rows = this.app
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
}
