<script setup lang="ts">
/**
 * 卡片（圆角 12，surface 底色，border 描边）
 * 标题 15px Medium；右侧操作文案通过 extra 插槽传入。
 */
withDefaults(
  defineProps<{
    /** 卡片标题（可选） */
    title?: string
    /** 标题下方辅助说明（可选） */
    subtitle?: string
    /** 是否使用页面边距内边距（默认是） */
    padded?: boolean
  }>(),
  { title: '', subtitle: '', padded: true },
)
</script>

<template>
  <view class="app-card" :class="{ 'app-card--flush': !padded }">
    <view v-if="title || $slots.extra" class="app-card__header">
      <view class="app-card__heading">
        <text v-if="title" class="app-card__title">{{ title }}</text>
        <text v-if="subtitle" class="app-card__subtitle">{{ subtitle }}</text>
      </view>
      <view v-if="$slots.extra" class="app-card__extra">
        <slot name="extra" />
      </view>
    </view>
    <view class="app-card__body">
      <slot />
    </view>
  </view>
</template>

<style lang="scss">
.app-card {
  background-color: $color-surface;
  border: 1px solid $color-border;
  border-radius: $radius-card;
  overflow: hidden;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: $spacing-sm;
    padding: $spacing-md $spacing-lg;
  }

  &__heading {
    flex: 1;
    min-width: 0;
  }

  &__title {
    display: block;
    font-size: $font-size-card-title;
    font-weight: $font-weight-medium;
    color: $color-text-1;
    line-height: 1.4;
  }

  &__subtitle {
    display: block;
    margin-top: 2px;
    font-size: $font-size-aux;
    color: $color-text-3;
    line-height: $line-height-body;
  }

  &__extra {
    flex: none;
    font-size: $font-size-aux;
    color: $color-primary;
  }

  &__body {
    padding: 0 $spacing-lg $spacing-lg;
  }

  /* 无内边距（用于内部自定义分隔的内容） */
  &--flush &__body {
    padding: 0;
  }
}
</style>
