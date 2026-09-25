import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthService } from './admin-auth.service';

/**
 * 角色与权限矩阵（T14，B10）。
 * 任何已登录后台账号可查看（权限矩阵本身不敏感；具体操作仍按权限拦截）。
 */
@ApiTags('后台·权限矩阵')
@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @ApiOperation({ summary: '角色与权限矩阵（任何已登录后台账号可查看）' })
  @Get()
  list() {
    return this.adminAuth.listRoles();
  }
}
