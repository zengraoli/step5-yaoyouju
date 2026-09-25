import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from './api-error';
import { AuthService } from '../modules/auth/auth.service';

export const IS_PUBLIC_KEY = 'isPublic';

/** 全局登录守卫：标注 @Public() 的路由跳过，其余要求 Bearer 令牌 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = [context.getHandler(), context.getClass()].some(
      (target) => this.reflector.get<boolean>(IS_PUBLIC_KEY, target) === true,
    );
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest();
    const header = (req.headers['authorization'] ?? '') as string;
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = token ? this.auth.verifyToken(token) : null;
    if (!user) {
      throw new ApiException(ErrorCode.UNAUTHORIZED, '请先登录');
    }
    req.user = user;
    return true;
  }
}
