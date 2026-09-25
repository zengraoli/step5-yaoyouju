<script setup lang="ts">
/**
 * 就医提示入口（全局可达）
 * 产品红线：命中红旗信号时立即显示就医提示，不被登录、付费、上传或长问卷阻断；
 * 因此本入口无需登录，任意页面可直接引入。
 */
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    /** 入口文案（默认与三端一致） */
    text?: string
  }>(),
  { text: '出现严重症状？无需登录，立即查看就医提示' },
)

/** 跳转就医提示页（pages/emergency/notice） */
function goNotice() {
  uni.navigateTo({ url: '/pages/emergency/notice' })
}
</script>

<template>
  <view class="emergency-entry" hover-class="emergency-entry--hover" :hover-stay-time="80" @click="goNotice">
    <AppIcon class="emergency-entry__icon" name="alert" :size="18" />
    <text class="emergency-entry__text">{{ text }}</text>
    <AppIcon class="emergency-entry__arrow" name="arrow-right" :size="16" />
  </view>
</template>

<style lang="scss">
.emergency-entry {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  min-height: $button-height;
  padding: $spacing-sm $spacing-md;
  border: 1px solid $color-error;
  border-radius: $radius-button;
  background-color: $color-error-light;

  &__icon {
    color: $color-error;
    flex: none;
  }

  &__text {
    flex: 1;
    font-size: $font-size-body;
    font-weight: $font-weight-medium;
    color: $color-error;
    line-height: 1.4;
  }

  &__arrow {
    color: $color-error;
    flex: none;
  }

  &--hover {
    opacity: 0.85;
  }
}
</style>
