import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { RequirePermission } from './permission.decorator';
import { AdminContext } from './admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { AdminUsersService, ADMIN_ROLES } from './admin-users.service';

class InviteUserDto {
  @ApiProperty({ description: '成员账号（工作邮箱）' })
  @IsString()
  @MaxLength(100)
  @Matches(/^[\w.@-]{2,100}$/, { message: '账号格式不正确（2-100 位字母 / 数字 / . @ -）' })
  name!: string;

  @ApiProperty({ description: '角色', enum: [...ADMIN_ROLES] })
  @IsIn([...ADMIN_ROLES], { message: `角色必须是：${ADMIN_ROLES.join(' / ')}` })
  role!: string;

  @ApiProperty({ description: '初始口令（仅传输与哈希，不落明文）' })
  @IsString()
  @Matches(/^.{8,100}$/, { message: '初始口令至少 8 位' })
  password!: string;

  @ApiProperty({ description: '双人确认单 ID（邀请超级管理员需另一名超级管理员确认）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
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

  @ApiProperty({ description: '双人确认单 ID（停用超级管理员需另一名超级管理员确认）', required: false })
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

/**
 * 后台成员与权限（B10）：成员表、权限矩阵来源、邀请 / 停用 / 重置 MFA。
 * 业务逻辑见 AdminUsersService（供双人确认执行器复用）。
 */
@ApiTags('admin-users')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @ApiOperation({ summary: '成员表（MFA / 状态 / 最近登录；不含明文口令；合规监督 / 超级管理可读）' })
  @RequirePermission('user.view')
  @Get()
  list() {
    return this.users.list();
  }

  @ApiOperation({ summary: '邀请成员（无自助注册；仅超级管理员；MFA 需首次登录绑定）' })
  @RequirePermission('user.manage')
  @Post()
  invite(@CurrentAdmin() admin: AdminContext, @Body() dto: InviteUserDto) {
    return this.users.invite(admin, dto);
  }

  @ApiOperation({ summary: '停用 / 启用成员（超级管理员需双人确认；写审计）' })
  @RequirePermission('user.manage')
  @Post(':id/status')
  setStatus(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: StatusDto,
  ) {
    return this.users.setStatus(admin, id, dto);
  }

  @ApiOperation({ summary: '重置 MFA（仅超级管理员；写审计；该账号下次登录需重新绑定）' })
  @RequirePermission('user.manage')
  @Post(':id/reset-mfa')
  resetMfa(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    return this.users.resetMfa(admin, id);
  }
}
