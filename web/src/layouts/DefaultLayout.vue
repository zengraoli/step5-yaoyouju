<script setup lang="ts">
/**
 * 整体布局：顶部导航（品牌 + 主导航 + 登录态）+ 内容区 + 底部说明。
 * 用户侧固定入口：当前情况 / 问与解释 / 病程 / 复诊准备 / 我的；社区不占首屏。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()

const NAV_ITEMS = [
  { key: 'dashboard', label: '当前情况', path: '/dashboard' },
  { key: 'analysis', label: '问与解释', path: '/qa' },
  { key: 'timeline', label: '病程', path: '/timeline' },
  { key: 'followup', label: '复诊准备', path: '/followup' },
  { key: 'account', label: '我的', path: '/account' },
  { key: 'contents', label: '审核内容库', path: '/contents' },
]

const activeKey = computed(() => (route.meta.nav as string) ?? '')

function onLogout() {
  auth.logout()
}
</script>

<template>
  <div class="layout">
    <header class="layout__header">
      <div class="layout__header-inner">
        <RouterLink to="/" class="layout__brand">
          <BrandLogo size="sm" :show-name="true" />
        </routerLink>
        <nav class="layout__nav" aria-label="主导航">
          <RouterLink
            v-for="item in NAV_ITEMS"
            :key="item.key"
            :to="item.path"
            class="layout__nav-item"
            :class="{ 'layout__nav-item--active': activeKey === item.key }"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <div class="layout__actions">
          <template v-if="auth.isLoggedIn">
            <span class="layout__phone">{{ auth.phoneMasked }}</span>
            <button class="layout__logout" type="button" @click="onLogout">退出登录</button>
          </template>
          <RouterLink v-else to="/login" class="layout__login">登录 / 注册</RouterLink>
        </div>
      </div>
    </header>

    <main class="layout__main">
      <RouterView />
    </main>

    <footer class="layout__footer">
      <span>腰有据帮助你理解资料与准备复诊，不代替医生诊断。</span>
      <span class="layout__footer-emergency">
        出现严重症状？无需登录，<RouterLink to="/emergency">立即查看就医提示</RouterLink>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.layout__header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.layout__header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--spacing-md) var(--spacing-xxl);
  display: flex;
  align-items: center;
  gap: var(--spacing-xxl);
}

.layout__brand {
  text-decoration: none;
  color: inherit;
}

.layout__nav {
  display: flex;
  gap: var(--spacing-xs);
  flex: 1;
}

.layout__nav-item {
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-button);
  font-size: var(--font-size-body);
  color: var(--color-text-2);
  text-decoration: none;
  transition: background-color 0.15s, color 0.15s;
}

.layout__nav-item:hover {
  background: var(--color-bg);
  color: var(--color-text-1);
}

.layout__nav-item--active {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.layout__actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.layout__phone {
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}

.layout__logout,
.layout__login {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  background: var(--color-surface);
  font-size: var(--font-size-aux);
  color: var(--color-primary);
  cursor: pointer;
  text-decoration: none;
}

.layout__logout:hover,
.layout__login:hover {
  border-color: var(--color-primary);
}

.layout__main {
  flex: 1;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: var(--spacing-xxl);
}

.layout__footer {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  padding: var(--spacing-lg) var(--spacing-xxl);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.layout__footer-emergency a {
  color: var(--color-error);
}
</style>
