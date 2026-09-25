import { Controller, Get } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';

/**
 * 角色与权限矩阵（T14，B10）。
 * 任何已登录后台账号可查看（权限矩阵本身不敏感；具体操作仍按权限拦截）。
 */
@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Get()
  list() {
    return this.adminAuth.listRoles();
  }
}
