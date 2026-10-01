import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { hashAdminPassword } from '../../common/password';
import { ROLE_PERMISSIONS } from './admin.constants';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AdminContext, AdminAuthService } from './admin-auth.service';
import { ConfirmationService } from './confirmation.service';

export const ADMIN_ROLES = ['运营编辑', '临床审核', '技术负责人', '合规支持', '超级管理员'] as const;

export interface InviteUserInput {
  name: string;
  role: string;
  password: string;
  confirmation_id?: string;
}

export interface SetStatusInput {
  active: boolean;
  reason?: string;
  confirmation_id?: string;
}

/**
 * 后台成员治理（B10）：成员表、邀请 / 停用 / 启用 / 重置 MFA。
 * - 邀请默认不开启 MFA，首次登录强制绑定后才能操作（AdminGuard 统一拦截）；
 * - 停用超级管理员必须走双人确认（另一名超级管理员确认）；
 * - 停用 / 重置 MFA 会立即吊销该账号名下全部令牌。
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger('AdminUsers');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly adminAuth: AdminAuthService,
    private readonly confirmations: ConfirmationService,
  ) {}

  /** 成员表（MFA / 状态 / 最近登录 / 权限；不含明文口令） */
  list() {
    const rows = this.db.app
      .prepare(
        `SELECT u.id, u.name, u.mfa_enabled, u.status, r.name AS role_name
         FROM admin_user u JOIN role r ON r.id = u.role_id
         ORDER BY u.name ASC`,
      )
      .all() as {
      id: string;
      name: string;
      mfa_enabled: number;
      status: string;
      role_name: string;
    }[];
    return rows.map((r) => {
      const login = this.db.app
        .prepare(
          `SELECT created_at FROM audit_log WHERE action = 'admin.login' AND target LIKE ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(`%${r.name}%`) as { created_at: string } | undefined;
      return {
        id: r.id,
        name: r.name,
        role: r.role_name,
        mfa: r.mfa_enabled === 1 ? '已绑定' : '未绑定',
        mfa_enabled: r.mfa_enabled === 1,
        status: r.status === 'active' ? '正常' : '已停用',
        active: r.status === 'active',
        last_login: login?.created_at ?? null,
        permissions: ROLE_PERMISSIONS[r.role_name] ?? [],
      };
    });
  }

  /** 邀请成员（无自助注册；仅超级管理员；MFA 需首次登录绑定） */
  invite(admin: AdminContext, input: InviteUserInput) {
    const role = this.db.app.prepare('SELECT id, name FROM role WHERE name = ?').get(input.role) as
      | { id: string; name: string }
      | undefined;
    if (!role) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '角色不存在');
    }
    const name = input.name.trim();
    const dup = this.db.app.prepare('SELECT id FROM admin_user WHERE name = ?').get(name) as
      | { id: string }
      | undefined;
    if (dup) {
      throw new ApiException(ErrorCode.CONFLICT, `已存在同名账号「${name}」，请换一个账号名`);
    }
    // 邀请超级管理员属于最高风险，必须另请一名超级管理员双人确认（验收反馈第 6 条）
    if (input.role === '超级管理员') {
      const invitationId = (input as { confirmation_id?: string }).confirmation_id;
      const gate = this.confirmations.prepare(
        'user.invite_super',
        name,
        `邀请超级管理员「${name}」`,
        invitationId ? `另一人已确认邀请超级管理员「${name}」` : `邀请超级管理员「${name}」`,
        admin,
        invitationId,
        { name, role: input.role, password_hash: hashAdminPassword(input.password) },
      );
      if (!gate.proceed) {
        throw new ApiException(
          ErrorCode.CONFLICT,
          `已提交「邀请超级管理员」双人确认申请（需${gate.confirmation?.requirement ?? '另一名超级管理员'}确认后生效）`,
          { confirmation_id: gate.confirmation?.id ?? null, requirement: gate.confirmation?.requirement ?? null },
        );
      }
      return this.createInvitedSuper(name, gate.confirmation!.id, gate.confirmation!.payload, admin.id);
    }
    const id = randomUUID();
    this.db.app
      .prepare(
        'INSERT INTO admin_user (id, name, role_id, mfa_enabled, password_hash, status, mfa_bonded_at, created_by) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
      )
      .run(id, name, role.id, hashAdminPassword(input.password), 'active', null, admin.id);
    this.audit.append(admin.id, 'admin_user.invite', `admin_user:${id}`, { name, role: input.role });
    this.logger.log(`[admin-users] ${admin.name} 邀请成员 ${name}（${input.role}，MFA 待绑定）`);
    return { id, name, role: input.role, mfa: '未绑定', mfa_required: true };
  }

  /** 邀请超级管理员：仅供双人确认通过后调用（payload 里是创建时确定的 name / role / password_hash） */
  createInvitedSuper(
    name: string,
    confirmationId: string,
    payload: Record<string, unknown>,
    actorId: string,
  ) {
    const roleName = typeof payload.role === 'string' ? payload.role : '超级管理员';
    const role = this.db.app.prepare('SELECT id, name FROM role WHERE name = ?').get(roleName) as
      | { id: string; name: string }
      | undefined;
    if (!role) throw new ApiException(ErrorCode.BAD_REQUEST, '角色不存在');
    const targetName = (typeof payload.name === 'string' ? payload.name : name).trim();
    const passwordHash = typeof payload.password_hash === 'string' ? payload.password_hash : '';
    if (!passwordHash) throw new ApiException(ErrorCode.BAD_REQUEST, '邀请参数不完整，请重新发起');
    const dup = this.db.app.prepare('SELECT id FROM admin_user WHERE name = ?').get(targetName) as
      | { id: string }
      | undefined;
    if (dup) {
      throw new ApiException(ErrorCode.CONFLICT, `已存在同名账号「${targetName}」，请换一个账号名`);
    }
    const id = randomUUID();
    this.db.app
      .prepare(
        'INSERT INTO admin_user (id, name, role_id, mfa_enabled, password_hash, status, mfa_bonded_at, created_by) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
      )
      .run(id, targetName, role.id, passwordHash, 'active', null, actorId);
    this.confirmations.markApplied(confirmationId);
    this.audit.append(actorId, 'admin_user.invite', `admin_user:${id}`, {
      name: targetName,
      role: role.name,
      confirmation_id: confirmationId,
    });
    this.logger.log(`[admin-users] 双人确认后邀请超级管理员 ${targetName}（确认人 ${actorId}）`);
    return { id, name: targetName, role: role.name, mfa: '未绑定', mfa_required: true };
  }

  /** 停用 / 启用成员（超级管理员需双人确认；写审计） */
  setStatus(admin: AdminContext, id: string, input: SetStatusInput) {
    const target = this.db.app.prepare('SELECT * FROM admin_user WHERE id = ?').get(id) as
      | { id: string; name: string; status: string }
      | undefined;
    if (!target) {
      throw new ApiException(ErrorCode.NOT_FOUND, '成员不存在');
    }
    if (!input.active && target.id === admin.id) {
      throw new ApiException(ErrorCode.FORBIDDEN, '不能停用当前登录账号');
    }
    let confirmId: string | null = null;
    if (!input.active) {
      const roleName = this.roleNameOf(id);
      if (roleName === '超级管理员') {
        const gate = this.confirmations.prepare(
          'user.status',
          id,
          target.name,
          input.confirmation_id ? `另一人已确认停用 ${target.name}` : `停用超级管理员 ${target.name}`,
          admin,
          input.confirmation_id,
          { active: false, reason: input.reason ?? '停用超级管理员' },
        );
        if (!gate.proceed) {
          throw new ApiException(
            ErrorCode.CONFLICT,
            `已提交「停用超级管理员」双人确认申请（需${gate.confirmation?.requirement ?? '另一名超级管理员'}确认后生效）`,
          );
        }
        confirmId = gate.confirmation?.id ?? null;
      }
    }
    if (target.status === (input.active ? 'active' : 'disabled')) {
      throw new ApiException(ErrorCode.CONFLICT, input.active ? '该成员已是启用状态' : '该成员已是停用状态');
    }
    const before = target.status;
    this.db.app.prepare('UPDATE admin_user SET status = ? WHERE id = ?').run(input.active ? 'active' : 'disabled', id);
    if (!input.active) {
      this.adminAuth.revokeTokensOf(id);
    }
    if (confirmId) this.confirmations.markApplied(confirmId);
    this.audit.append(admin.id, 'admin_user.status', `admin_user:${id}`, {
      active: input.active,
      from: before,
      to: input.active ? 'active' : 'disabled',
      name: target.name,
    });
    this.logger.log(`[admin-users] ${admin.name} ${input.active ? '启用' : '停用'}成员 ${target.name}`);
    return { id, active: input.active };
  }

  /** 重置 MFA（该账号下次登录需重新绑定；立即吊销令牌） */
  resetMfa(admin: AdminContext, id: string) {
    const target = this.db.app.prepare('SELECT id, name FROM admin_user WHERE id = ?').get(id) as
      | { id: string; name: string }
      | undefined;
    if (!target) {
      throw new ApiException(ErrorCode.NOT_FOUND, '成员不存在');
    }
    this.db.app.prepare('UPDATE admin_user SET mfa_enabled = 0, mfa_bonded_at = NULL WHERE id = ?').run(id);
    this.adminAuth.revokeTokensOf(id);
    this.audit.append(admin.id, 'admin_user.reset_mfa', `admin_user:${id}`, { name: target.name });
    this.logger.log(`[admin-users] ${admin.name} 重置了 ${target.name} 的 MFA`);
    return { id, mfa: '未绑定', mfa_enabled: false };
  }

  private roleNameOf(id: string): string | undefined {
    const row = this.db.app
      .prepare('SELECT r.name AS name FROM admin_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?')
      .get(id) as { name: string } | undefined;
    return row?.name;
  }
}
