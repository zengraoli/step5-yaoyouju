<script setup lang="ts">
/**
 * 底部 TabBar（信息架构固定五个入口：当前情况 / 问与解释 / 病程 / 复诊准备 / 我的）
 * - 自绘 SVG 图标，当前项使用 primary 色
 * - 五个入口均为 tabBar 页面，使用 uni.switchTab 切换
 * 说明：五个主入口的底部导航由 pages.json 原生 tabBar 承载；
 *      本组件用于非 tab 页（如就医提示页）保持底部导航可达。
 */
import { computed } from 'vue'
import AppIcon, { type IconName } from './AppIcon.vue'

export type TabKey = 'index' | 'qa' | 'timeline' | 'followup' | 'mine'

interface TabItem {
  key: TabKey
  label: string
  icon: IconName
  path: string
}

/** 五个入口（顺序与设计规范一致） */
const TABS: TabItem[] = [
  { key: 'index', label: '当前情况', icon: 'home', path: '/pages/index/index' },
  { key: 'qa', label: '问与解释', icon: 'chat', path: '/pages/qa/index' },
  { key: 'timeline', label: '病程', icon: 'timeline', path: '/pages/timeline/index' },
  { key: 'followup', label: '复诊准备', icon: 'clipboard', path: '/pages/followup/index' },
  { key: 'mine', label: '我的', icon: 'user', path: '/pages/mine/index' },
]

const props = withDefaults(
  defineProps<{
    /** 当前选中项；不传时按当前页面路由自动判断 */
    current?: TabKey
  }>(),
  {},
)

const emit = defineEmits<{
  (e: 'change', key: TabKey): void
}>()

/** 按当前页面路由推断选中项 */
function currentFromRoute(): TabKey | null {
  const pages = getCurrentPages()
  const last = pages[pages.length - 1] as unknown as { route?: string } | undefined
  const route = last?.route ?? ''
  const seg = route.replace(/^\//, '').split('/').slice(0, 2).join('/')
  const found = TABS.find((t) => t.path.replace(/^\//, '') === seg)
  return found ? found.key : null
}

const currentKey = computed<TabKey | null>(() => props.current ?? currentFromRoute())

function onTap(item: TabItem) {
  if (item.key === currentKey.value) return
  emit('change', item.key)
  uni.switchTab({ url: item.path })
}
</script>

<template>
  <view class="tabbar">
    <view
      v-for="item in TABS"
      :key="item.key"
      class="tabbar__item"
      :class="{ 'tabbar__item--active': item.key === currentKey }"
      @click="onTap(item)"
    >
      <AppIcon class="tabbar__icon" :name="item.icon" :size="22" />
      <text class="tabbar__label">{{ item.label }}</text>
    </view>
  </view>
</template>

<style lang="scss">
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  display: flex;
  background-color: $color-surface;
  border-top: 1px solid $color-border;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);

  &__item {
    flex: 1;
    min-height: $tap-size;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: $tabbar-height;
    color: $color-text-3;

    &--active {
      color: $color-primary;
    }
  }

  &__label {
    font-size: $font-size-tag;
    font-weight: $font-weight-medium;
    line-height: 1.2;
  }
}

/* 使用本组件的页面在内容底部预留同等高度 */
.tabbar-placeholder {
  height: calc(#{$tabbar-height} + constant(safe-area-inset-bottom));
  height: calc(#{$tabbar-height} + env(safe-area-inset-bottom));
}
</style>
