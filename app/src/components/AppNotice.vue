<script setup lang="ts">
/**
 * 提示条（设计规范：信息提示 info / 提醒 warn / 就医提示 error）
 * - 就医提示（error）带图标，且只做提示、不阻断页面操作
 * 产品红线：命中红旗信号时立即展示，不被登录、付费、上传或长问卷阻断。
 * 颜色一律走主题变量（见 src/uni.scss），不在此处硬编码。
 */
import AppIcon, { type IconName } from './AppIcon.vue'
import { computed } from 'vue'

type NoticeType = 'info' | 'warn' | 'error'

const props = withDefaults(
  defineProps<{
    /** 提示类型 */
    type?: NoticeType
    /** 标题（可选） */
    title?: string
  }>(),
  { type: 'info', title: '' },
)

/** 各类型对应图标 */
const NOTICE_ICON: Record<NoticeType, IconName> = {
  info: 'info',
  warn: 'alert',
  error: 'alert',
}

const icon = computed<IconName>(() => NOTICE_ICON[props.type])
</script>

<template>
  <view class="app-notice" :class="`app-notice--${type}`">
    <AppIcon class="app-notice__icon" :name="icon" :size="18" />
    <view class="app-notice__body">
      <text v-if="title" class="app-notice__title">{{ title }}</text>
      <view class="app-notice__content">
        <slot />
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.app-notice {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  padding: $spacing-md;
  border-radius: $radius-card;
  background-color: $color-info-light;

  &__icon {
    margin-top: 1px;
    flex: none;
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__title {
    display: block;
    font-size: $font-size-card-title;
    font-weight: $font-weight-medium;
    line-height: 1.4;
    margin-bottom: 2px;
  }

  &__content {
    font-size: $font-size-body;
    color: $color-text-2;
    line-height: $line-height-body;
  }

  /* 信息提示 */
  &--info &__icon,
  &--info &__title {
    color: $color-info;
  }

  /* 提醒 */
  &--warn {
    background-color: $color-warn-light;
  }

  &--warn &__icon,
  &--warn &__title {
    color: $color-warn;
  }

  /* 就医提示（不阻断操作） */
  &--error {
    background-color: $color-error-light;
  }

  &--error &__icon,
  &--error &__title {
    color: $color-error;
  }
}
</style>
