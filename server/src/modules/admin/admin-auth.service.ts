import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { hashAdminPassword, safeEqual } from '../../common/password';
import { DbService } from '../../db/db.service';
import { permissionCatalog, permissionsOf } from './admin.constants';

/** 后台账号上下文（AdminGuard 注入 req.admin） */
export interface AdminContext {
  id: string;
  name: string;
  role: { id: string; name: string };
  permissions: string[];
}

export interface AdminLoginResult {
  token: string;
  admin: {
    id: string;
    name: string;
    role: { id: string; name: string };
    permissions: string[];
    mfa_enabled: boolean;
  };
}

interface AdminUserRow {
  id: string;
  name: string;
  role_id: string;
  role_name: string;
  mfa_enabled: number;
  password_hash: string;
  status: string;
}

const TOKEN_PREFIX = 'av1'; // admin token v1，与用户端 'v1' 区分（两套令牌互不通用）
const TOKEN_TTL_MS = 30 * 60 * 1000; // 后台短会话：30 分钟
const MAX_FAILED_ATTEMPTS = 5; // 连续失败锁定阈值
const LOCK_MS = 15 * 60 * 1000; // 锁定时长 15 分钟

interface AttemptState {
  fails: number;
  lockedUntil: number;
}

/**
 * 后台账号与登录（T14，B01）：
 * - 账号 + 口令 + TOTP（演示固定码取 env ADMIN_TOTP_DEMO_CODE，默认 123456）；
 * - 无自助注册；连续失败 5 次锁定 15 分钟（内存记录，重启即清零）；
 * - 口令用 timingSafeEqual 比较 sha256 哈希；登录成功 / 失败都写审计（不记录口令与验证码）；
 * - 令牌 HMAC-SHA256 签名，密钥取 env ADMIN_TOKEN_SECRET，未设置时用派生密钥（仅本地演示）。
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger('AdminAuth');
  private readonly secret: string;
  /** 连续失败记录：账号名 → { 失败次数, 锁定截止时间 }（内存 Map，演示实现） */
  private readonly attempts = new Map<string, AttemptState>();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {
    this.secret =
      process.env.ADMIN_TOKEN_SECRET?.trim() ||
      this.db.crypto.blindIndex('admin-token-secret').slice(0, 32); // 演示用派生密钥，生产必须配置环境变量
  }

  private get app(): DatabaseSync {
    return this.db.app;
  }

  /** 后台登录：账号 + 口令 + TOTP */
  login(name: string, password: string, totp: string): AdminLoginResult {
    const account = (name ?? '').trim();
    if (!account) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请输入账号');
    }
    // 锁定检查先于凭证校验：锁定期间一律拒绝
    const state = this.attempts.get(account);
    if (state && state.lockedUntil > Date.now()) {
      this.appendFailure(null, account, '账号已锁定');
      throw new ApiException(ErrorCode.FORBIDDEN, '账号已锁定，请稍后再试');
    }

    const row = this.findByName(account);
    if (!row) {
      this.recordFailure(account);
      this.appendFailure(null, account, '账号不存在');
      throw new ApiException(ErrorCode.UNAUTHORIZED, '账号、口令或验证码不正确，请重新输入');
    }
    if (row.status !== 'active') {
      this.appendFailure(row.id, account, '账号已禁用');
      throw new ApiException(ErrorCode.FORBIDDEN, '账号状态异常，请联系超级管理员');
    }
    if (!safeEqual(this.hashPassword(password), row.password_hash)) {
      this.recordFailure(account);
      this.appendFailure(row.id, account, '口令错误');
      throw new ApiException(ErrorCode.UNAUTHORIZED, '账号、口令或验证码不正确，请重新输入');
    }
    if (!safeEqual(totp ?? '', this.demoTotp())) {
      this.recordFailure(account);
      this.appendFailure(row.id, account, '验证码错误');
      throw new ApiException(ErrorCode.UNAUTHORIZED, '账号、口令或验证码不正确，请重新输入');
    }

    // 登录成功：清零失败计数
    this.attempts.delete(account);
    this.audit.append(row.id, 'admin.login', `admin_user:${row.id}`, {
      name: row.name,
      role: row.role_name,
    });
    this.logger.log(`[admin-auth] 登录成功 ${row.name}（${row.role_name}）`);
    return { token: this.issueToken(row.id), admin: this.profileOf(row) };
  }

  /** 登出：令牌为无状态签名，登出即客户端丢弃；这里写审计留痕 */
  logout(admin: AdminContext): { ok: true } {
    this.audit.append(admin.id, 'admin.logout', `admin_user:${admin.id}`, { name: admin.name });
    return { ok: true };
  }

  /** 当前后台账号（角色、权限） */
  me(adminId: string): AdminLoginResult['admin'] {
    const row = this.findById(adminId);
    if (!row) {
      throw new ApiException(ErrorCode.UNAUTHORIZED, '请先登录');
    }
    return this.profileOf(row);
  }

  /** 角色与权限矩阵（B10 展示；角色取数据库，权限取矩阵，保证单一数据源） */
  listRoles(): { roles: { id: string; name: string; permissions: string[] }[]; catalog: { code: string; label: string }[] } {
    const rows = this.app
      .prepare('SELECT id, name FROM role ORDER BY rowid ASC')
      .all() as { id: string; name: string }[];
    return {
      roles: rows.map((r) => ({ id: r.id, name: r.name, permissions: permissionsOf(r.name) })),
      catalog: permissionCatalog(),
    };
  }

  /** 校验后台令牌：签名 + 有效期（30 分钟）+ 账号仍然有效；无效返回 null */
  verifyToken(token: string): AdminContext | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    if (!safeEqual(expected, parts[2])) return null;
    const [adminId, expRaw] = payload.split('.');
    const exp = Number(expRaw);
    if (!adminId || !Number.isFinite(exp) || exp < Date.now()) return null;
    const row = this.findById(adminId);
    if (!row || row.status !== 'active') return null;
    return {
      id: row.id,
      name: row.name,
      role: { id: row.role_id, name: row.role_name },
      permissions: permissionsOf(row.role_name),
    };
  }

  // ---------- 内部 ----------

  private issueToken(adminId: string): string {
    const exp = Date.now() + TOKEN_TTL_MS;
    const payload = `${adminId}.${exp}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${TOKEN_PREFIX}.${Buffer.from(payload).toString('base64url')}.${sig}`;
  }

  private demoTotp(): string {
    return process.env.ADMIN_TOTP_DEMO_CODE ?? '123456';
  }

  private hashPassword(password: string): string {
    return hashAdminPassword(password);
  }

  /** 记录一次失败；达到阈值即锁定 15 分钟 */
  private recordFailure(account: string): void {
    const prev = this.attempts.get(account);
    const fails = (prev?.fails ?? 0) + 1;
    const lockedUntil = fails >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCK_MS : (prev?.lockedUntil ?? 0);
    this.attempts.set(account, { fails, lockedUntil });
    if (lockedUntil > Date.now()) {
      this.logger.warn(`[admin-auth] 账号 ${account} 连续失败 ${fails} 次，已锁定 15 分钟`);
    }
  }

  /** 登录失败审计：只记录账号与原因，不记录口令 / 验证码 */
  private appendFailure(actorId: string | null, account: string, reason: string): void {
    this.audit.append(actorId, 'admin.login_failed', `admin_user:${account}`, { reason });
  }

  private findByName(name: string): AdminUserRow | undefined {
    return this.app
      .prepare(
        `SELECT u.id, u.name, u.role_id, u.mfa_enabled, u.password_hash, u.status, r.name AS role_name
         FROM admin_user u JOIN role r ON r.id = u.role_id WHERE u.name = ?`,
      )
      .get(name) as AdminUserRow | undefined;
  }

  private findById(id: string): AdminUserRow | undefined {
    return this.app
      .prepare(
        `SELECT u.id, u.name, u.role_id, u.mfa_enabled, u.password_hash, u.status, r.name AS role_name
         FROM admin_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(id) as AdminUserRow | undefined;
  }

  private profileOf(row: AdminUserRow): AdminLoginResult['admin'] {
    return {
      id: row.id,
      name: row.name,
      role: { id: row.role_id, name: row.role_name },
      permissions: permissionsOf(row.role_name),
      mfa_enabled: row.mfa_enabled === 1,
    };
  }
}

/** 演示锁定与会话参数（README / 测试说明用） */
export const ADMIN_LOCK_POLICY = { maxFailedAttempts: MAX_FAILED_ATTEMPTS, lockMs: LOCK_MS, tokenTtlMs: TOKEN_TTL_MS };
