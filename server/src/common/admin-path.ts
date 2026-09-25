/**
 * 后台路径判定（T14）。
 * 全局用户端 AuthGuard 对 /admin 前缀放行，由 AdminGuard 统一负责后台鉴权，
 * 两套账号体系（用户端令牌 / 后台令牌）互不通用。
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

/** 是否为后台路径（/admin 或 /admin/...） */
export function isAdminPath(req: PathLikeRequest): boolean {
  const path = fullPath(req);
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?');
}
