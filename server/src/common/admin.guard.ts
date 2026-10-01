import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException, ErrorCode } from './api-error';
import { IS_PUBLIC_KEY } from './auth.guard';
import { isAdminPath } from './admin-path';
import { AdminAuthService } from '../modules/admin/admin-auth.service';

/**
 * 后台守卫（T14，B01）：只保护 /admin 前缀路径。
 * - 校验 Authorization: Bearer <admin token>（30 分钟有效，HMAC-SHA256 签名）；
 * - 注入 req.admin = { id, name, role, permissions, mfa_enabled }；
 * - 同时写 req.user = { id }，兼容既有 /admin 控制器上的 @CurrentUser()（记录审计操作人）；
 * - 用户端 AuthGuard 对 /admin 放行，本守卫是后台接口的唯一鉴权入口（账号体系隔离）。
 *
 * MFA 强制（验收反馈第 31 条）：新邀请成员 / 重置 MFA 后的账号未绑定动态验证码时，
 * 只能调用绑定、查询自身与登出接口，其他操作一律 40300（页面文案与之一致）。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  /** 未绑定 MFA 时仍可访问的接口（绑定 / 查询自身 / 登出） */
  private static readonly MFA_EXEMPT_PATHS = [
    '/admin/auth/login',
    '/admin/auth/bind-mfa',
    '/admin/auth/me',
    '/admin/auth/logout',
  ];

  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!isAdminPath(req)) return true; // 非后台路径不干预（用户端体系）
    const isPublic = [context.getHandler(), context.getClass()].some(
      (target) => this.reflector.get<boolean>(IS_PUBLIC_KEY, target) === true,
    );
    if (isPublic) return true; // 如后台登录接口（无自助注册，登录本身不需要令牌）
    const header = (req.headers['authorization'] ?? '') as string;
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const admin = token ? this.adminAuth.verifyToken(token) : null;
    if (!admin) {
      throw new ApiException(ErrorCode.UNAUTHORIZED, '请先登录');
    }
    req.admin = admin;
    req.user = { id: admin.id };
    if (!admin.mfa_enabled) {
      const path = String(req.path ?? req.url ?? '');
      if (!AdminGuard.MFA_EXEMPT_PATHS.some((p) => path === p || path.startsWith(`${p}?`))) {
        throw new ApiException(
          ErrorCode.FORBIDDEN,
          '首次登录需先绑定动态验证码（MFA），绑定后才能操作后台',
        );
      }
    }
    return true;
  }
}
