<script setup lang="ts">
/**
 * 芯片（设计规范：已选 / 未选 / 跳过）
 * - 已选：主色描边 + primary-light 底色 + 对勾
 * - 未选：常规描边
 * - 跳过：弱化文字（用户主动跳过，不视为阴性 / 无）
 * 点击区域通过 ::after 扩展到 44px 高，满足最小点击区域要求。
 */
import AppIcon from './AppIcon.vue'

type ChipState = 'selected' | 'unselected' | 'skipped'

withDefaults(
  defineProps<{
    label: string
    /** 状态：selected 已选 / unselected 未选 / skipped 跳过 */
    state?: ChipState
    disabled?: boolean
  }>(),
  { state: 'unselected', disabled: false },
)

const emit = defineEmits<{
  (e: 'click'): void
}>()
</script>

<template>
  <view
    class="app-chip"
    :class="[`app-chip--${state}`, { 'app-chip--disabled': disabled }]"
    role="button"
    :aria-label="label"
    @click="!disabled && emit('click')"
  >
    <AppIcon v-if="state === 'selected'" name="check" :size="14" />
    <text class="app-chip__label">{{ label }}</text>
  </view>
</template>

<style lang="scss">
.app-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: $spacing-xs;
  min-height: 34px;
  padding: 0 $spacing-md;
  border: 1px solid $color-border;
  border-radius: $radius-pill;
  background-color: $color-surface;
  font-size: $font-size-aux-lg;
  color: $color-text-2;
  line-height: 1.2;

  /* 扩大点击热区到 44px 高 */
  &::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -5px;
    bottom: -5px;
  }

  /* 已选 */
  &--selected {
    border-color: $color-primary;
    background-color: $color-primary-light;
    color: $color-primary;
    font-weight: $font-weight-medium;
  }

  /* 跳过（用户主动跳过，不默认阴性） */
  &--skipped {
    border-style: dashed;
    color: $color-text-3;
  }

  &--disabled {
    opacity: 0.5;
  }
}

.app-chip__label {
  font-size: $font-size-aux-lg;
}
</style>
