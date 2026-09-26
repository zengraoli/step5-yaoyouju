<script setup lang="ts">
/** 按钮：主按钮 / 次按钮 / 柔和 / 危险 */
withDefaults(
  defineProps<{
    type?: 'primary' | 'secondary' | 'soft' | 'danger'
    block?: boolean
    loading?: boolean
    disabled?: boolean
    size?: 'sm' | 'md'
  }>(),
  { type: 'primary', block: false, loading: false, disabled: false, size: 'md' },
)

defineEmits<{ (e: 'click', ev: MouseEvent): void }>()
</script>

<template>
  <button
    class="app-button"
    :class="[`app-button--${type}`, { 'app-button--block': block, 'app-button--sm': size === 'sm' }]"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="app-button__spinner" aria-hidden="true" />
    <span><slot /></span>
  </button>
</template>

<style scoped>
.app-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  min-height: 36px;
  padding: 6px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-button);
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: opacity 0.15s, background-color 0.15s, border-color 0.15s;
}

.app-button--sm {
  min-height: 28px;
  padding: 2px 10px;
  font-size: var(--font-size-aux-sm);
}

.app-button--block {
  display: flex;
  width: 100%;
}

.app-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.app-button--primary {
  background: var(--color-primary);
  color: #fff;
}

.app-button--primary:hover:not(:disabled) {
  opacity: 0.9;
}

.app-button--secondary {
  background: var(--color-surface);
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.app-button--soft {
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.app-button--danger {
  background: var(--color-error);
  color: #fff;
}

.app-button__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
