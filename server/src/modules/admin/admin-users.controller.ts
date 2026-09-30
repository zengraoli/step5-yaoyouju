import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { RequirePermission } from './permission.decorator';
import { AdminContext } from './admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { hashAdminPassword } from '../../common/password';
import { ROLE_PERMISSIONS } from './admin.constants';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AdminAuthService } from './admin-auth.service';
import { ConfirmationService } from './confirmation.service';

class InviteUserDto {
  @ApiProperty({ description: '成员账号（工作邮箱）' })
  @IsString()
  @MaxLength(100)
  @Matches(/^[\w.@-]{2,100}$/, { message: '账号格式不正确（2-100 位字母 / 数字 / . @ -）' })
  name!: string;

  @ApiProperty({ description: '角色', enum: ['运营编辑', '临床审核', '技术负责人', '合规支持', '超级管理员'] })
  @IsIn(['运营编辑', '临床审核', '技术负责人', '合规支持', '超级管理员'])
  role!: string;

  @ApiProperty({ description: '初始口令（仅传输与哈希，不落明文）' })
  @IsString()
  @Matches(/^.{8,100}$/, { message: '初始口令至少 8 位' })
  password!: string;

  @ApiProperty({ description: '双人确认单 ID（停用成员需另一名超级管理员确认）', required: false })
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

class StatusDto {
  @ApiProperty({ description: 'true 启用 / false 停用' })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ description: '变更原因（写审计）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiProperty({ description: '双人确认单 ID（停用成员需另一名超级管理员确认）', required: false })
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

/**
 * 后台成员与权限（B10）：成员表、权限矩阵来源、邀请 / 停用 / 重置 MFA。
 * - 邀请默认不开启 MFA，首次登录强制绑定后才能操作（演示码 123456）；
 * - 停用成员同样走双人确认（验收反馈第 35 条：不能一个人停用管理员或停用自己）。
 */
@ApiTags('admin-users')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly adminAuth: AdminAuthService,
    private readonly confirmations: ConfirmationService,
  ) {}

  @ApiOperation({ summary: '成员表（MFA / 状态 / 最近登录；不含明文口令；合规监督 / 超级管理可读）' })
  @RequirePermission('user.view')
  @Get()
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
    // 最近登录（审计日志中该账号的登录成功记录）
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

  @ApiOperation({ summary: '邀请成员（无自助注册；仅超级管理员；MFA 需首次登录绑定）' })
  @RequirePermission('user.manage')
  @Post()
  invite(@CurrentAdmin() admin: AdminContext, @Body() dto: InviteUserDto) {
    const role = this.db.app.prepare('SELECT id, name FROM role WHERE name = ?').get(dto.role) as
      | { id: string; name: string }
      | undefined;
    if (!role) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '角色不存在');
    }
    const name = dto.name.trim();
    const dup = this.db.app.prepare('SELECT id FROM admin_user WHERE name = ?').get(name) as
      | { id: string }
      | undefined;
    if (dup) {
      throw new ApiException(ErrorCode.CONFLICT, '已存在同名账号「' + name + '」，请换一个账号名');
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.app
      .prepare(
        'INSERT INTO admin_user (id, name, role_id, mfa_enabled, password_hash, status, mfa_bonded_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
      )
      .run(id, name, role.id, hashAdminPassword(dto.password), 'active', null);
    this.audit.append(admin.id, 'admin_user.invite', `admin_user:${id}`, {
      name,
      role: dto.role,
    });
    return { id, name, role: dto.role, mfa: '未绑定', mfa_required: true };
  }

  @ApiOperation({ summary: '停用 / 启用成员（需双人确认；写审计）' })
  @RequirePermission('user.manage')
  @Post(':id/status')
  setStatus(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: StatusDto,
  ) {
    const target = this.db.app.prepare('SELECT * FROM admin_user WHERE id = ?').get(id) as
      | { id: string; name: string; status: string }
      | undefined;
    if (!target) {
      throw new ApiException(ErrorCode.NOT_FOUND, '成员不存在');
    }
    if (!dto.active && target.id === admin.id) {
      throw new ApiException(ErrorCode.FORBIDDEN, '不能停用当前登录账号');
    }
    if (!dto.active) {
      // 超级管理员不能被单独停用：需要另一名超级管理员双人确认（验收反馈第 35 条）
      const roleName = (
        this.db.app
          .prepare('SELECT r.name AS name FROM admin_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?')
          .get(id) as { name: string } | undefined
      )?.name;
      if (roleName === '超级管理员') {
        const gate = this.confirmations.prepare(
          'user.status',
          id,
          target.name,
          dto.confirmation_id ? `另一人已确认停用 ${target.name}` : `停用超级管理员 ${target.name}`,
          admin,
          dto.confirmation_id,
        );
        if (!gate.proceed) {
          throw new ApiException(
            ErrorCode.CONFLICT,
            `已提交「停用超级管理员」双人确认申请（需${gate.confirmation?.requirement ?? '另一名超级管理员'}确认后生效）`,
          );
        }
      }
    }
    const before = target.status;
    this.db.app.prepare('UPDATE admin_user SET status = ? WHERE id = ?').run(dto.active ? 'active' : 'disabled', id);
    if (!dto.active) {
      // 停用即吊销该账号可能仍持有的令牌（兜底：短期会话本身会过期）
      this.adminAuth.revokeTokensOf(id);
    }
    this.audit.append(admin.id, 'admin_user.status', `admin_user:${id}`, {
      active: dto.active,
      from: before,
      to: dto.active ? 'active' : 'disabled',
      name: target.name,
    });
    return { id, active: dto.active };
  }

  @ApiOperation({ summary: '重置 MFA（仅超级管理员；写审计；该账号下次登录需重新绑定）' })
  @RequirePermission('user.manage')
  @Post(':id/reset-mfa')
  resetMfa(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    const target = this.db.app.prepare('SELECT id, name FROM admin_user WHERE id = ?').get(id) as
      | { id: string; name: string }
      | undefined;
    if (!target) {
      throw new ApiException(ErrorCode.NOT_FOUND, '成员不存在');
    }
    this.db.app.prepare('UPDATE admin_user SET mfa_enabled = 0 WHERE id = ?').run(id);
    this.adminAuth.revokeTokensOf(id);
    this.audit.append(admin.id, 'admin_user.reset_mfa', `admin_user:${id}`, { name: target.name });
    return { id, mfa: '未绑定', mfa_enabled: false };
  }
}
