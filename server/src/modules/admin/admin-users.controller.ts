import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { RequirePermission } from './permission.decorator';
import { AdminContext } from './admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { hashAdminPassword } from '../../common/password';
import { ROLE_PERMISSIONS } from './admin.constants';

class InviteUserDto {
  @ApiProperty({ description: '成员账号（工作邮箱）' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '角色', enum: ['运营编辑', '临床审核', '技术', '合规', '超级管理'] })
  @IsIn(['运营编辑', '临床审核', '技术', '合规', '超级管理'])
  role!: string;

  @ApiProperty({ description: '初始口令（仅传输与哈希，不落明文）' })
  @IsString()
  @MaxLength(100)
  password!: string;
}

class StatusDto {
  @ApiProperty({ description: 'true 启用 / false 停用' })
  @IsBoolean()
  active!: boolean;
}

void IsOptional;

/** 后台成员与权限（B10）：成员表、权限矩阵来源、邀请 / 停用 / 重置 MFA */
@ApiTags('admin-users')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: '成员表（MFA / 状态 / 最近登录；不含明文口令）' })
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
        status: r.status === 'active' ? '正常' : '已停用',
        last_login: login?.created_at ?? '—',
        permissions: ROLE_PERMISSIONS[r.role_name] ?? [],
      };
    });
  }

  @ApiOperation({ summary: '邀请成员（无自助注册；仅超级管理员）' })
  @RequirePermission('user.manage')
  @Post()
  invite(@CurrentAdmin() admin: AdminContext, @Body() dto: InviteUserDto) {
    const role = this.db.app.prepare('SELECT id, name FROM role WHERE name = ?').get(dto.role) as
      | { id: string; name: string }
      | undefined;
    if (!role) {
      throw new Error('角色不存在');
    }
    const id = randomUUID();
    this.db.app
      .prepare(
        'INSERT INTO admin_user (id, name, role_id, mfa_enabled, password_hash, status) VALUES (?, ?, ?, 0, ?, ?)',
      )
      .run(id, dto.name.trim(), role.id, hashAdminPassword(dto.password), 'active');
    this.audit.append(admin.id, 'admin_user.invite', `admin_user:${id}`, {
      name: dto.name.trim(),
      role: dto.role,
    });
    return { id, name: dto.name.trim(), role: dto.role };
  }

  @ApiOperation({ summary: '停用 / 启用成员（仅超级管理员；写审计）' })
  @RequirePermission('user.manage')
  @Post(':id/status')
  setStatus(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: StatusDto,
  ) {
    this.db.app
      .prepare('UPDATE admin_user SET status = ? WHERE id = ?')
      .run(dto.active ? 'active' : 'disabled', id);
    this.audit.append(admin.id, 'admin_user.status', `admin_user:${id}`, { active: dto.active });
    return { id, active: dto.active };
  }

  @ApiOperation({ summary: '重置 MFA（仅超级管理员；写审计）' })
  @RequirePermission('user.manage')
  @Post(':id/reset-mfa')
  resetMfa(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    this.db.app.prepare('UPDATE admin_user SET mfa_enabled = 0 WHERE id = ?').run(id);
    this.audit.append(admin.id, 'admin_user.reset_mfa', `admin_user:${id}`, {});
    return { id, mfa: '未绑定' };
  }
}
