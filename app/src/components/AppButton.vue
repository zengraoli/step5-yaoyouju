<script setup lang="ts">
/**
 * 按钮（设计规范：主按钮 / 次按钮 / 柔和 / 危险·就医）
 * - disabled、loading：loading 与 disabled 时不可点击，避免重复提交
 * - 最小点击区域 44×44，圆角 10
 */
import { computed } from 'vue'
import AppIcon, { type IconName } from './AppIcon.vue'

type ButtonType = 'primary' | 'secondary' | 'soft' | 'danger'

const props = withDefaults(
  defineProps<{
    /** 按钮类型：primary 主按钮 / secondary 次按钮 / soft 柔和 / danger 危险·就医 */
    type?: ButtonType
    disabled?: boolean
    loading?: boolean
    /** 是否占满一行 */
    block?: boolean
    /** 文字前图标（自绘 SVG） */
    icon?: IconName
  }>(),
  {
    type: 'primary',
    disabled: false,
    loading: false,
    block: false,
  },
)

const emit = defineEmits<{
  (e: 'click'): void
}>()

/** loading 与 disabled 均不可点击 */
const isDisabled = computed(() => props.disabled || props.loading)

function onClick() {
  if (isDisabled.value) return
  emit('click')
}
</script>

<template>
  <button
    class="app-button"
    :class="[
      `app-button--${type}`,
      { 'app-button--block': block, 'app-button--disabled': isDisabled },
    ]"
    type="button"
    :disabled="isDisabled"
    hover-class="app-button--hover"
    :hover-stay-time="80"
    @click="onClick"
  >
    <span v-if="loading" class="app-button__spinner" />
    <AppIcon v-else-if="icon" :name="icon" :size="18" />
    <text class="app-button__label"><slot /></text>
  </button>
</template>

<style lang="scss">
.app-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-sm;
  min-width: $tap-size;
  min-height: $button-height;
  margin: 0;
  padding: 0 $spacing-lg;
  border: 1px solid transparent;
  border-radius: $radius-button;
  font-family: $font-family;
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  line-height: 1.2;
  text-align: center;
  background-color: transparent;
  transition: opacity 0.15s ease;

  /* 去掉 H5 按钮默认边框（uni-app reset 之外再兜底） */
  &::after {
    border: none;
  }

  &--block {
    display: flex;
    width: 100%;
  }

  &--disabled {
    opacity: 0.45;
  }

  /* 主按钮 */
  &--primary {
    background-color: $color-primary;
    color: $color-surface;
  }

  /* 次按钮 */
  &--secondary {
    background-color: $color-surface;
    border-color: $color-border;
    color: $color-text-1;
  }

  /* 柔和 */
  &--soft {
    background-color: $color-primary-light;
    color: $color-primary;
  }

  /* 危险 · 就医 */
  &--danger {
    background-color: $color-error;
    color: $color-surface;
  }
}

/* 点击反馈 */
.app-button--hover {
  opacity: 0.85;
}

/* loading 旋转指示（currentColor 着色） */
.app-button__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: app-button-spin 0.8s linear infinite;
}

@keyframes app-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
