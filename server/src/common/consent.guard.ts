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
      // 撤回同意后：只读接口仍可查看（「已导出文件与病程只读仍可使用」），写接口一律拒绝；
      // 从未同意过的用户连只读也不放行（健康信息处理的默认状态是不处理）。
      const method = String(req.method ?? 'GET').toUpperCase();
      if ((method === 'GET' || method === 'HEAD') && this.auth.everConsented(user.id, scope as ConsentScope)) {
        req.user = { ...user, consent_revoked: true };
        return true;
      }
      throw new ApiException(
        ErrorCode.CONSENT_REQUIRED,
        `已撤回「${scope}」，不能再继续写入；可在“我的-数据与授权”中重新同意`,
      );
    }
    return true;
  }
}
