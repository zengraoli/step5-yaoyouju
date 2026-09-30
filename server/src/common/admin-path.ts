/**
 * 后台路径判定（T14）。
 * 全局用户端 AuthGuard 对 /admin 前缀放行，由 AdminGuard 统一负责后台鉴权，
 * 两套账号体系（用户端令牌 / 后台令牌）互不通用。
 *
 * 路径比较一律忽略大小写：`/ADMIN/...`、`/Admin/...` 与 `/admin/...` 同样属于后台
 * 路径，避免大小写变体绕过后台鉴权（验收反馈：任意用户令牌访问 /ADMIN/* 返回 200）。
 */
export interface PathLikeRequest {
  baseUrl?: string;
  path?: string;
  url?: string;
}

/** 完整请求路径（含 baseUrl，Express 下 app 挂在根路径时等价于 req.path） */
export function fullPath(req: PathLikeRequest): string {
  if (req.baseUrl && req.path) return `${req.baseUrl}${req.path}`;
  if (req.path) return req.path;
  return (req.url ?? '').split('?')[0];
}

/** 是否为后台路径（任意大小写的 /admin 或 /admin/...） */
export function isAdminPath(req: PathLikeRequest): boolean {
  const path = fullPath(req).toLowerCase();
  return path === '/admin' || path.startsWith('/admin/') || path === '/admin';
}
