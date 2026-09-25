import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../modules/auth/auth.service';

/** 注入当前登录用户（{ id }） */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.user as AuthUser;
});
