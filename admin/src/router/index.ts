import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AdminLayout from '@/layouts/AdminLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { public: true, title: '后台登录' },
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
        meta: { nav: 'contents', title: '内容库', permission: 'content.draft' },
      },
      {
        path: 'evidence',
        name: 'evidence',
        component: () => import('@/views/evidence/EvidenceView.vue'),
        meta: { nav: 'evidence', title: '医学证据库', permission: 'evidence.manage' },
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
        meta: { nav: 'safety', title: '安全与开关', permission: 'switch.manage' },
      },
      {
        path: 'models',
        name: 'models',
        component: () => import('@/views/models/ModelsView.vue'),
        meta: { nav: 'models', title: '模型与评测', permission: 'model.manage' },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/views/users/UsersView.vue'),
        meta: { nav: 'users', title: '用户与权限', permission: 'user.manage' },
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

/** 登录态守卫：未登录跳登录页；权限在布局与页面内按 store 判断（最小必要） */
router.beforeEach((to) => {
  const token = localStorage.getItem('yyj_admin_token')
  if (!to.meta.public && !token) {
    return { name: 'login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } }
  }
  return true
})

router.afterEach((to) => {
  document.title = `${(to.meta.title as string) ?? '后台管理系统'} · 腰有据`
})

export default router
