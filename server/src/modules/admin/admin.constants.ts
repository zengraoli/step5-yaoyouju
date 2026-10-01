/**
 * 角色权限矩阵（T14，B10；docs/system-design.md 第 3 节 ROLE.permissions）。
 * 以 docs/design/admin/B10.png 的权限矩阵为准：最小必要原则，每个角色只拿得到
 * 本角色页面所需的权限，不含完整病历。
 * 权限与控制器通过 @RequirePermission('xxx') 声明，PermissionGuard 统一校验。
 * 新增权限必须在此登记（code + 中文说明），并同步 server/README.md。
 *
 * B10 矩阵要点（逐个核对设计稿）：
 * - 超级管理员不做医学审定（content.review 不授予），其余管理权限齐全；
 * - 运营编辑可建草稿 / 提交 / 发起发布 / 举报初筛，不能医学审定与临床复核；
 * - 临床审核负责审定、发布、撤回 / 下线、证据核实、举报临床复核与单条授权；
 * - 技术负责人负责高危开关、模型发布与评测，可脱敏查看用户资料，不读举报与案例；
 * - 合规支持负责监督：审计查看、单条授权记录、成员列表，可发起双人确认设置变更与审计导出申请；
 * - 临床审核可改非高危开关（switch.manage_low），高危开关仍属技术负责人；
 * - 成员管理（邀请 / 停用 / 重置 MFA）仅超级管理员。
 */

/** 超级管理通配符：拥有除医学审定外的全部权限 */
export const ALL_PERMISSIONS = '*';

/** 角色 → 权限列表（角色名与 seed.ts 的 role.name 保持一致） */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  运营编辑: [
    'content.draft',
    'content.submit',
    'evidence.ingest',
    'feedback.view',
    'feedback.triage',
    'consent.view',
  ],
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
    'model.view',
    'eval.view',
  ],
  技术负责人: [
    'switch.manage',
    'model.manage',
    'model.view',
    'eval.manage',
    'eval.view',
    'consent.view',
  ],
  合规支持: [
    'consent.view',
    'user.view',
    'audit.view',
    'audit.export_request',
    'dual_control.manage',
  ],
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
    'feedback.triage',
    'consent.view',
    'switch.manage',
    'model.manage',
    'model.view',
    'eval.manage',
    'eval.view',
    'user.view',
    'user.manage',
    'audit.view',
    'audit.export_request',
    'audit.export_approve',
    'case.manage',
    'dual_control.manage',
  ],
};

/** 权限中文说明（供 B10 权限矩阵展示） */
export const PERMISSION_LABELS: Record<string, string> = {
  'content.draft': '内容：编辑草稿 / 提交',
  'content.review': '内容：审定 / 退回',
  'content.publish': '内容：发布（双人）',
  'content.offline': '内容：撤回 / 应急下线',
  'evidence.ingest': '证据库：录入 / 核实 / 停用',
  'evidence.verify': '证据：核实（标记许可已确认）',
  'evidence.deactivate': '证据：停用 / 启用',
  'feedback.triage': '举报：初筛',
  'feedback.view': '举报与反馈队列查看',
  'feedback.handle': '举报：临床复核与明文授权',
  'model.view': '模型与评测集查看',
  'model.manage': '模型发布管理（候选 / 灰度 / 生效 / 回滚）',
  'eval.manage': '评测集与回归运行',
  'eval.view': '评测集与回归结果查看',
  'switch.manage': '功能开关变更（含高危）',
  'switch.manage_low': '非高危功能开关变更',
  'audit.view': '审计日志查看与哈希链校验',
  'consent.view': '单条授权记录查看',
  'audit.export_request': '审计日志导出申请',
  'audit.export_approve': '审计日志导出审批',
  'dual_control.manage': '双人确认设置',
  'user.view': '后台成员列表查看（监督）',
  'user.manage': '成员邀请 / 停用 / 重置 MFA',
};

/** B10 权限矩阵的展示结构（与设计稿逐行对应） */
export interface MatrixRow {
  key: string;
  label: string;
  cells: Record<string, boolean | 'half'>;
}

export function permissionMatrix(): MatrixRow[] {
  const yes = (p: string) => (role: string): boolean | 'half' => {
    const perms = ROLE_PERMISSIONS[role] ?? [];
    if (perms.includes(ALL_PERMISSIONS)) return true;
    if (perms.includes(p)) return true;
    return false;
  };
  const halfIf = (p: string) => (role: string): boolean | 'half' => {
    const perms = ROLE_PERMISSIONS[role] ?? [];
    if (perms.includes(ALL_PERMISSIONS)) return true;
    if (perms.includes(p)) return true;
    // 运营编辑 / 临床审核没有 content.review 时按「发起/申请」半权限展示
    if (p === 'content.review' && (perms.includes('content.submit') || perms.includes('feedback.handle'))) {
      return 'half';
    }
    if (p === 'eval.manage' && perms.includes('eval.view')) return 'half';
    return false;
  };
  const roles = ['运营编辑', '临床审核', '技术负责人', '合规支持', '超级管理员'];
  const row = (key: string, label: string, cell: (role: string) => boolean | 'half'): MatrixRow => {
    const cells: Record<string, boolean | 'half'> = {};
    for (const r of roles) cells[r] = cell(r);
    return { key, label, cells };
  };
  return [
    row('content.draft', '内容：编辑草稿 / 提交', yes('content.draft')),
    row('content.review', '内容：审定 / 退回', halfIf('content.review')),
    row('content.publish', '内容：发布（双人）', yes('content.publish')),
    row('content.offline', '内容：撤回 / 应急下线', yes('content.offline')),
    row('evidence.ingest', '证据库：录入 / 核实 / 停用', (role) => {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      if (perms.includes(ALL_PERMISSIONS)) return true;
      return perms.includes('evidence.ingest');
    }),
    row('feedback.triage', '举报：初筛 / 临床复核', (role) => {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      if (perms.includes(ALL_PERMISSIONS)) return true;
      if (perms.includes('feedback.handle') && perms.includes('feedback.triage')) return true;
      if (perms.includes('feedback.handle')) return 'half';
      if (perms.includes('feedback.triage')) return true;
      return false;
    }),
    row('consent.view', '用户资料：脱敏查看 / 明文授权', (role) => {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      if (perms.includes(ALL_PERMISSIONS)) return true;
      if (perms.includes('feedback.handle')) return true;
      return perms.includes('consent.view');
    }),
    row('switch.manage', '功能开关 / 模型发布', (role) => {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      if (perms.includes(ALL_PERMISSIONS)) return true;
      if (perms.includes('switch.manage') || perms.includes('model.manage')) return true;
      if (perms.includes('switch.manage_low')) return 'half';
      return false;
    }),
    row('eval.manage', '评测集 / 评测运行', (role) => {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      if (perms.includes(ALL_PERMISSIONS)) return true;
      if (perms.includes('eval.manage')) return true;
      if (perms.includes('eval.view')) return 'half';
      return false;
    }),
    row('user.manage', '成员与角色 / 审计导出审批', (role) => {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      if (perms.includes(ALL_PERMISSIONS)) return true;
      if (perms.includes('user.manage') || perms.includes('audit.export_approve')) return true;
      if (perms.includes('audit.export_request') || perms.includes('user.view')) return 'half';
      return false;
    }),
  ];
}

/** 高危功能开关：变更需 switch.manage（技术负责人 / 超级管理） */
export const HIGH_RISK_SWITCHES = ['个性化分析', '案例卡片'];

/** 角色权限（未知角色不给任何权限） */
export function permissionsOf(roleName: string): string[] {
  return ROLE_PERMISSIONS[roleName] ?? [];
}

/** 是否具备权限（超级管理通配） */
export function hasPermission(permissions: string[], required: string): boolean {
  if (permissions.includes(ALL_PERMISSIONS)) return true;
  if (permissions.includes(required)) return true;
  // 内容查看：运营编辑（可建草稿）/ 临床审核（审定）/ 超级管理可读；
  // 技术负责人与合规支持不能读内容数据（验收反馈第 14 条）
  if (required === 'content.view' && permissions.includes('content.draft')) return true;
  if (required === 'content.view' && permissions.includes('content.review')) return true;
  // 高危开关权限隐含非高危开关权限（技术负责人 / 超级管理可改全部开关）
  if (required === 'switch.manage_low' && permissions.includes('switch.manage')) return true;
  // 查看权限被管理权限隐含
  if (required === 'model.view' && (permissions.includes('model.manage') || permissions.includes('eval.manage'))) {
    return true;
  }
  if (required === 'eval.view' && permissions.includes('eval.manage')) return true;
  if (required === 'audit.view' && permissions.includes('audit.export_approve')) return true;
  return false;
}

/** 权限目录（B10 展示用） */
export function permissionCatalog(): { code: string; label: string }[] {
  return Object.entries(PERMISSION_LABELS).map(([code, label]) => ({ code, label }));
}
