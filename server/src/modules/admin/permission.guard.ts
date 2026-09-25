import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AuditService } from '../../common/audit.service';
import { AdminContext } from './admin-auth.service';
import { REQUIRE_PERMISSION_KEY } from './permission.decorator';
import { hasPermission } from './admin.constants';

/**
 * 权限守卫（T14）：按 @RequirePermission 声明校验后台角色权限。
 * 越权返回 40300「没有权限执行该操作」，并写审计（admin.permission_denied，只追加）。
 * 依赖 AdminGuard 先执行（req.admin 已注入）。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = [context.getHandler(), context.getClass()]
      .map((target) => this.reflector.get<string>(REQUIRE_PERMISSION_KEY, target))
      .find((p): p is string => typeof p === 'string');
    if (!required) return true;
    const req = context.switchToHttp().getRequest();
    const admin = req.admin as AdminContext | undefined;
    if (!admin) {
      throw new ApiException(ErrorCode.UNAUTHORIZED, '请先登录');
    }
    if (!hasPermission(admin.permissions, required)) {
      const path = `${req.method ?? ''} ${req.path ?? ''}`.trim();
      this.audit.append(admin.id, 'admin.permission_denied', path, {
        permission: required,
        role: admin.role.name,
      });
      throw new ApiException(ErrorCode.FORBIDDEN, '没有权限执行该操作');
    }
    return true;
  }
}
