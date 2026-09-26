/**
 * 角色权限矩阵（T14，B10；docs/system-design.md 第 3 节 ROLE.permissions）。
 * 最小必要原则：每个角色只拿得到本角色页面所需的权限，不含完整病历。
 * 权限与控制器通过 @RequirePermission('xxx') 声明，PermissionGuard 统一校验。
 * 新增权限必须在此登记（code + 中文说明），并同步 server/README.md。
 */

/** 超级管理通配符：拥有全部权限 */
export const ALL_PERMISSIONS = '*';

/** 角色 → 权限列表（角色名与 seed.ts 的 role.name 保持一致） */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  运营编辑: ['content.draft', 'content.submit'],
  临床审核: ['content.review', 'content.publish', 'content.offline'],
  技术负责人: ['model.manage', 'eval.manage', 'switch.manage', 'evidence.manage'],
  合规支持: [
    'feedback.view',
    'feedback.handle',
    'audit.view',
    'consent.view',
    'audit.export',
    'dual_control.manage',
  ],
  超级管理员: [ALL_PERMISSIONS],
};

/** 权限中文说明（供 B10 权限矩阵展示） */
export const PERMISSION_LABELS: Record<string, string> = {
  'content.draft': '创建与编辑内容草稿',
  'content.submit': '提交内容审核',
  'content.review': '医学审核（通过 / 退回）',
  'content.publish': '发布内容',
  'content.offline': '一键下线 / 撤回内容',
  'model.manage': '模型发布管理（候选 / 灰度 / 生效 / 回滚）',
  'eval.manage': '评测集与回归运行',
  'switch.manage': '功能开关变更',
  'evidence.manage': '医学证据库管理',
  'feedback.view': '举报与反馈队列查看',
  'feedback.handle': '举报处置',
  'audit.view': '审计日志查看与哈希链校验',
  'consent.view': '单条授权记录查看',
  'audit.export': '审计日志导出申请与审批',
  'dual_control.manage': '双人确认设置',
};

/** 角色权限（未知角色不给任何权限） */
export function permissionsOf(roleName: string): string[] {
  return ROLE_PERMISSIONS[roleName] ?? [];
}

/** 是否具备权限（超级管理通配） */
export function hasPermission(permissions: string[], required: string): boolean {
  if (permissions.includes(ALL_PERMISSIONS)) return true;
  return permissions.includes(required);
}

/** 权限目录（B10 展示用） */
export function permissionCatalog(): { code: string; label: string }[] {
  return Object.entries(PERMISSION_LABELS).map(([code, label]) => ({ code, label }));
}
