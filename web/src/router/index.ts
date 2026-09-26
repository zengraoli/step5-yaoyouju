import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { public: true, title: '登录与授权' },
  },
  {
    path: '/emergency',
    name: 'emergency',
    component: () => import('@/views/emergency/EmergencyView.vue'),
    meta: { public: true, title: '就医提示' },
  },
  {
    path: '/',
    component: DefaultLayout,
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/views/home/HomeView.vue'),
        meta: { title: '腰有据' },
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/DashboardView.vue'),
        meta: { nav: 'dashboard', title: '当前情况' },
      },
      {
        path: 'qa',
        name: 'qa',
        component: () => import('@/views/qa/QaView.vue'),
        meta: { nav: 'analysis', title: '问与解释' },
      },
      {
        path: 'timeline',
        name: 'timeline',
        component: () => import('@/views/timeline/TimelineView.vue'),
        meta: { nav: 'timeline', title: '病程' },
      },
      {
        path: 'followup',
        name: 'followup',
        component: () => import('@/views/followup/FollowupView.vue'),
        meta: { nav: 'followup', title: '复诊准备' },
      },
      {
        path: 'account',
        name: 'account',
        component: () => import('@/views/account/AccountView.vue'),
        meta: { nav: 'account', title: '我的' },
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

/** 登录态守卫：公开页（登录 / 就医提示 / 404）放行，其余需登录 */
router.beforeEach((to) => {
  const token = localStorage.getItem('yyj_web_token')
  if (!to.meta.public && !token) {
    return { name: 'login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } }
  }
  return true
})

router.afterEach((to) => {
  const title = (to.meta.title as string) ?? '腰有据'
  document.title = `${title} · 腰有据`
})

export default router
