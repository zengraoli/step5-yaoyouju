import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * 声明接口所需权限（T14，B10 权限矩阵的落地）。
 * 由全局 PermissionGuard 校验：越权返回 40300「没有权限执行该操作」并写审计。
 * 可写在类上（整控制器）或方法上（方法优先），如 @RequirePermission('content.publish')。
 */
export const RequirePermission = (permission: string) => SetMetadata(REQUIRE_PERMISSION_KEY, permission);
