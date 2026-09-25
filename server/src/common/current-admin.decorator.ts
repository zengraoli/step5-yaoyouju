import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminContext } from '../modules/admin/admin-auth.service';

/** 注入当前后台账号（{ id, name, role, permissions }，由 AdminGuard 写入 req.admin） */
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.admin as AdminContext;
});
