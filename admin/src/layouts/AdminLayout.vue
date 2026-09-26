<script setup lang="ts">
/**
 * 后台整体布局：侧边栏按角色显示菜单（最小必要）+ 顶栏（标题 / 环境标识 / 账号）。
 * 路由守卫按权限拦截越权访问（见 router/index.ts）。
 */
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

interface MenuItem {
  key: string
  label: string
  path: string
  /** 所需权限（单一；不传时所有后台角色可见） */
  permission?: string
  /** 任一权限即可见（按 B10 角色职责） */
  anyOf?: string[]
}

/**
 * 全部菜单。anyOf = 具备任一权限即可见（按 B10 角色职责）：
 * - 内容库：运营编辑（草稿）/ 临床审核（审定发布下线）/ 超级管理
 * - 医学证据库：运营编辑（录入）/ 临床审核（核实停用）/ 超级管理
 * - 举报与反馈：运营编辑（初筛）/ 临床审核（处置）/ 超级管理（合规不读举报）
 * - 安全与开关：临床审核（非高危）/ 技术负责人 / 超级管理
 * - 用户与权限：合规支持（监督：单条授权 / 双人确认）/ 超级管理
 */
const ALL_MENUS: MenuItem[] = [
  { key: 'dashboard', label: '仪表盘', path: '/dashboard' },
  {
    key: 'contents',
    label: '内容库',
    path: '/contents',
    anyOf: ['content.draft', 'content.review', 'content.publish', 'content.offline'],
  },
  {
    key: 'evidence',
    label: '医学证据库',
    path: '/evidence',
    anyOf: ['evidence.ingest', 'evidence.verify', 'evidence.deactivate'],
  },
  { key: 'feedback', label: '举报与反馈', path: '/feedback', anyOf: ['feedback.view', 'feedback.handle'] },
  { key: 'safety', label: '安全与开关', path: '/safety', anyOf: ['switch.manage', 'switch.manage_low'] },
  { key: 'models', label: '模型与评测', path: '/models', anyOf: ['model.manage'] },
  { key: 'eval', label: '评测集与回归', path: '/eval', anyOf: ['eval.manage'] },
  { key: 'users', label: '用户与权限', path: '/users', anyOf: ['user.view', 'user.manage'] },
  { key: 'audit', label: '审计日志', path: '/audit', anyOf: ['audit.view'] },
  { key: 'cases', label: '案例投稿', path: '/cases', anyOf: ['case.manage'] },
]

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const menus = computed<MenuItem[]>(() =>
  ALL_MENUS.filter(
    (m) =>
      (!m.permission && !m.anyOf) ||
      (m.permission ? auth.hasPermission(m.permission) : false) ||
      (m.anyOf ? m.anyOf.some((p) => auth.hasPermission(p)) : false),
  ),
)

const activeKey = computed(() => (route.meta.nav as string) ?? '')

// 刷新后恢复身份：有令牌但缺少账号信息时拉取一次（角色与权限用于菜单与细粒度校验）
onMounted(() => {
  if (auth.isLoggedIn && !auth.admin) {
    auth.fetchMe().catch(() => {
      // 令牌失效：清理并回到登录页
      auth.logout()
      router.push('/login')
    })
  }
})

function onLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="admin-layout">
    <aside class="sidebar">
      <div class="sidebar__brand">
        <span class="sidebar__logo">腰</span>
        <span class="sidebar__brand-text">腰有据 · 后台管理系统</span>
      </div>
      <nav class="sidebar__nav">
        <RouterLink
          v-for="m in menus"
          :key="m.key"
          :to="m.path"
          class="sidebar__item"
          :class="{ 'sidebar__item--active': activeKey === m.key }"
        >
          {{ m.label }}
        </RouterLink>
      </nav>
      <div class="sidebar__foot">
        <span class="sidebar__env">生产环境</span>
        <span class="sidebar__note">后台与用户端分离</span>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <h1 class="topbar__title">{{ (route.meta.title as string) ?? '后台管理系统' }}</h1>
        <div class="topbar__right">
          <span class="topbar__env">生产环境</span>
          <span class="topbar__admin">{{ auth.admin?.name ?? '' }}（{{ auth.role }}）</span>
          <button type="button" class="topbar__logout" @click="onLogout">退出</button>
        </div>
      </header>
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-layout {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
}

.sidebar {
  background: #12202b;
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: var(--spacing-lg) var(--spacing-md);
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-xs) var(--spacing-lg);
}

.sidebar__logo {
  width: 32px;
  height: 32px;
  border-radius: 20%;
  background: var(--color-primary);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-weight-medium);
  flex-shrink: 0;
}

.sidebar__brand-text {
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
}

.sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  flex: 1;
}

.sidebar__item {
  display: block;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-button);
  font-size: var(--font-size-aux);
  color: rgba(255, 255, 255, 0.75);
}

.sidebar__item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.sidebar__item--active {
  background: var(--color-primary);
  color: #fff;
  font-weight: var(--font-weight-medium);
}

.sidebar__foot {
  padding-top: var(--spacing-md);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.sidebar__env {
  font-size: var(--font-size-aux-sm);
  color: #fff;
}

.sidebar__note {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding: var(--spacing-md) var(--spacing-page);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.topbar__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.topbar__env {
  padding: 2px 8px;
  border-radius: var(--radius-tag);
  background: var(--color-warn-light);
  color: var(--color-warn);
  font-size: var(--font-size-aux-sm);
}

.topbar__admin {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.topbar__logout {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  cursor: pointer;
}

.topbar__logout:hover {
  border-color: var(--color-error);
  color: var(--color-error);
}

.content {
  flex: 1;
  padding: var(--spacing-page);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

@media (max-width: 900px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }

  .sidebar {
    position: static;
    height: auto;
  }
}
</style>
