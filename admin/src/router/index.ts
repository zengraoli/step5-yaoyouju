import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AdminLayout from '@/layouts/AdminLayout.vue'
import { useAuthStore } from '@/stores/auth'

/** 权限判定：超级管理通配，其余按账号权限列表（与 server 的 hasPermission 口径一致） */
function hasAdminPermission(auth: ReturnType<typeof useAuthStore>, required: string): boolean {
  const perms = auth.permissions ?? []
  if (perms.includes('*')) return true
  if (perms.includes(required)) return true
  if (required === 'content.view' && (perms.includes('content.draft') || perms.includes('content.review'))) return true
  if (required === 'switch.manage_low' && perms.includes('switch.manage')) return true
  if (required === 'model.view' && (perms.includes('model.manage') || perms.includes('eval.manage'))) return true
  if (required === 'eval.view' && perms.includes('eval.manage')) return true
  if (required === 'audit.view' && perms.includes('audit.export_approve')) return true
  return false
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { public: true, title: '后台登录' },
  },
  {
    path: '/bind-mfa',
    name: 'bind-mfa',
    component: () => import('@/views/login/BindMfaView.vue'),
    meta: { title: '绑定动态验证码' },
  },
  {
    path: '/',
    component: AdminLayout,
    children: [
      { path: '', redirect: '/dashboard' },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/DashboardView.vue'),
        meta: { nav: 'dashboard', title: '仪表盘' },
      },
      {
        path: 'contents',
        name: 'contents',
        component: () => import('@/views/contents/ContentsView.vue'),
        meta: { nav: 'contents', title: '内容库', permission: 'content.view' },
      },
      {
        path: 'contents/:id',
        name: 'content-detail',
        component: () => import('@/views/contents/ContentDetailView.vue'),
        meta: { nav: 'contents', title: '内容详情', permission: 'content.view' },
      },
      {
        path: 'evidence',
        name: 'evidence',
        component: () => import('@/views/evidence/EvidenceView.vue'),
        meta: { nav: 'evidence', title: '医学证据库', permission: 'evidence.ingest' },
      },
      {
        path: 'feedback',
        name: 'feedback',
        component: () => import('@/views/feedback/FeedbackView.vue'),
        meta: { nav: 'feedback', title: '举报与反馈', permission: 'feedback.view' },
      },
      {
        path: 'safety',
        name: 'safety',
        component: () => import('@/views/safety/SafetyView.vue'),
        meta: { nav: 'safety', title: '安全与开关', permission: 'switch.manage_low' },
      },
      {
        path: 'models',
        name: 'models',
        component: () => import('@/views/models/ModelsView.vue'),
        meta: { nav: 'models', title: '模型与评测', permission: 'model.view' },
      },
      {
        path: 'eval',
        name: 'eval',
        component: () => import('@/views/eval/EvalView.vue'),
        meta: { nav: 'eval', title: '评测集与回归', permission: 'eval.view' },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/views/users/UsersView.vue'),
        meta: { nav: 'users', title: '用户与权限', permission: 'user.view' },
      },
      {
        path: 'audit',
        name: 'audit',
        component: () => import('@/views/audit/AuditView.vue'),
        meta: { nav: 'audit', title: '审计日志', permission: 'audit.view' },
      },
      {
        path: 'cases',
        name: 'cases',
        component: () => import('@/views/cases/CasesView.vue'),
        meta: { nav: 'cases', title: '案例投稿', permission: 'case.manage' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true, title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * 路由守卫：未登录跳登录页；按 meta.permission 校验角色权限，
 * 越权直接跳仪表盘并提示（地址栏直达菜单之外的页面不再照常渲染，验收反馈第 14 条）。
 */
router.beforeEach(async (to) => {
  const token = sessionStorage.getItem('yyj_admin_token')
  if (!to.meta.public && !token) {
    return { name: 'login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } }
  }
  // MFA 强制：新邀请 / 重置 MFA 后的账号必须先绑定动态验证码，否则任何页面都进不去
  if (to.name !== 'bind-mfa' && token) {
    let mfaAuth = useAuthStore()
    if (!mfaAuth.admin) {
      try {
        await mfaAuth.fetchMe()
      } catch {
        mfaAuth.logout()
        return { name: 'login', query: { redirect: to.fullPath } }
      }
    }
    if (mfaAuth.admin && mfaAuth.admin.mfa_enabled === false) {
      return { path: '/bind-mfa', query: { redirect: to.fullPath } }
    }
  }
  const required = to.meta.permission as string | undefined
  if (!required) return true
  let auth = useAuthStore()
  if (!auth.admin) {
    try {
      await auth.fetchMe()
    } catch {
      auth.logout()
      return { name: 'login', query: { redirect: to.fullPath } }
    }
  }
  // fetchMe 失败时会静默返回 null：admin 仍为空时按无权限处理前先再取一次
  if (!auth.admin) {
    try {
      await auth.fetchMe()
      auth = useAuthStore()
    } catch {
      auth.logout()
      return { name: 'login', query: { redirect: to.fullPath } }
    }
  }
  if (!hasAdminPermission(auth, required)) {
    return { path: '/dashboard', query: { denied: '1' } }
  }
  return true
})

router.afterEach((to) => {
  document.title = `${(to.meta.title as string) ?? '后台管理系统'} · 腰有据`
})

export default router
