import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from './api-error';
import { REQUIRE_CONSENT_KEY } from './require-consent.decorator';
import { AuthService, ConsentScope } from '../modules/auth/auth.service';

/**
 * 同意守卫：未同意「健康信息处理」时拒绝使用分析等敏感功能。
 * 与 AuthGuard 配合使用（AuthGuard 先执行，保证 req.user 存在）。
 */
@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const scope = [context.getClass(), context.getHandler()]
      .map((target) => this.reflector.get<string>(REQUIRE_CONSENT_KEY, target))
      .find((s): s is string => typeof s === 'string');
    if (!scope) return true;
    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string } | undefined;
    if (!user) {
      throw new ApiException(ErrorCode.UNAUTHORIZED, '请先登录');
    }
    if (!this.auth.hasConsent(user.id, scope as ConsentScope)) {
      throw new ApiException(
        ErrorCode.CONSENT_REQUIRED,
        `需要先同意「${scope}」才能使用该功能，可在“我的-数据与授权”中单独同意`,
      );
    }
    return true;
  }
}
