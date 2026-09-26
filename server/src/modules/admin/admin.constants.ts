/**
 * 角色权限矩阵（T14，B10；docs/system-design.md 第 3 节 ROLE.permissions）。
 * 以 docs/design/admin/B10.png 的权限矩阵为准：最小必要原则，每个角色只拿得到
 * 本角色页面所需的权限，不含完整病历。
 * 权限与控制器通过 @RequirePermission('xxx') 声明，PermissionGuard 统一校验。
 * 新增权限必须在此登记（code + 中文说明），并同步 server/README.md。
 *
 * B10 矩阵要点：
 * - 超级管理员不做医学审定（content.review 不授予），其余管理权限齐全；
 * - 证据录入 / 核实 / 停用归临床审核，技术负责人不管证据库；
 * - 举报处置与明文授权归临床审核，合规支持不读举报队列；
 * - 临床审核可改非高危开关（switch.manage_low），高危开关仍属技术负责人；
 * - 成员列表仅合规支持（监督）与超级管理员（管理）可读。
 */

/** 超级管理通配符：拥有除医学审定外的全部权限 */
export const ALL_PERMISSIONS = '*';

/** 角色 → 权限列表（角色名与 seed.ts 的 role.name 保持一致） */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  运营编辑: ['content.draft', 'content.submit', 'evidence.ingest', 'feedback.view', 'consent.view'],
  临床审核: [
    'content.review',
    'content.publish',
    'content.offline',
    'evidence.ingest',
    'evidence.verify',
    'evidence.deactivate',
    'feedback.view',
    'feedback.handle',
    'consent.view',
    'switch.manage_low',
  ],
  技术负责人: ['switch.manage', 'model.manage', 'eval.manage', 'consent.view'],
  合规支持: ['consent.view', 'audit.view', 'audit.export', 'dual_control.manage', 'user.view'],
  超级管理员: [
    'content.draft',
    'content.submit',
    'content.publish',
    'content.offline',
    'evidence.ingest',
    'evidence.verify',
    'evidence.deactivate',
    'feedback.view',
    'feedback.handle',
    'consent.view',
    'switch.manage',
    'model.manage',
    'eval.manage',
    'user.view',
    'user.manage',
    'audit.view',
    'audit.export',
    'case.manage',
    'dual_control.manage',
  ],
};

/** 权限中文说明（供 B10 权限矩阵展示） */
export const PERMISSION_LABELS: Record<string, string> = {
  'content.draft': '创建与编辑内容草稿',
  'content.submit': '提交内容审核',
  'content.review': '医学审核（通过 / 退回）',
  'content.publish': '发布内容（双人）',
  'content.offline': '一键下线 / 撤回内容',
  'evidence.ingest': '证据录入（新建 / 编辑 / 切分入库）',
  'evidence.verify': '证据核实（标记许可已确认）',
  'evidence.deactivate': '证据停用 / 启用',
  'feedback.view': '举报与反馈队列查看',
  'feedback.handle': '举报处置与明文授权查看',
  'model.manage': '模型发布管理（候选 / 灰度 / 生效 / 回滚）',
  'eval.manage': '评测集与回归运行',
  'switch.manage': '功能开关变更（含高危）',
  'switch.manage_low': '非高危功能开关变更',
  'audit.view': '审计日志查看与哈希链校验',
  'consent.view': '单条授权记录查看',
  'audit.export': '审计日志导出申请与审批',
  'dual_control.manage': '双人确认设置',
  'user.view': '后台成员列表查看（监督）',
  'user.manage': '成员邀请 / 停用 / 重置 MFA',
};

/** 高危功能开关：变更需 switch.manage（技术负责人 / 超级管理） */
export const HIGH_RISK_SWITCHES = ['个性化分析'];

/** 角色权限（未知角色不给任何权限） */
export function permissionsOf(roleName: string): string[] {
  return ROLE_PERMISSIONS[roleName] ?? [];
}

/** 是否具备权限（超级管理通配） */
export function hasPermission(permissions: string[], required: string): boolean {
  if (permissions.includes(ALL_PERMISSIONS)) return true;
  if (permissions.includes(required)) return true;
  // 高危开关权限隐含非高危开关权限（技术负责人 / 超级管理可改全部开关）
  if (required === 'switch.manage_low' && permissions.includes('switch.manage')) return true;
  return false;
}

/** 权限目录（B10 展示用） */
export function permissionCatalog(): { code: string; label: string }[] {
  return Object.entries(PERMISSION_LABELS).map(([code, label]) => ({ code, label }));
}
