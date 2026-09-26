<script setup lang="ts">
/**
 * 提示条：信息提示 / 提醒 / 就医提示（与 App 端一致）
 * 就医提示带图标且不被任何流程阻断。
 */
withDefaults(defineProps<{ type?: 'info' | 'warn' | 'error' }>(), { type: 'info' })

const ICONS: Record<string, string> = {
  info: 'M12 11.2v5M12 7.8v.4',
  warn: 'M12 3.8 2.9 19.6h18.2zM12 9.6v4.2M12 16.6v.6',
  error: 'M12 3.8 2.9 19.6h18.2zM12 9.6v4.2M12 16.6v.6',
}
</script>

<template>
  <div class="app-notice" :class="`app-notice--${type}`">
    <svg
      class="app-notice__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path v-for="(d, i) in (ICONS[type] ?? '').split('M').filter(Boolean)" :key="i" :d="`M${d}`" />
    </svg>
    <div class="app-notice__body"><slot /></div>
  </div>
</template>

<style scoped>
.app-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-radius: var(--radius-button);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.app-notice--info {
  background: var(--color-info-light);
  color: var(--color-text-1);
}

.app-notice--info .app-notice__icon {
  color: var(--color-info);
}

.app-notice--warn {
  background: var(--color-warn-light);
  color: var(--color-text-1);
}

.app-notice--warn .app-notice__icon {
  color: var(--color-warn);
}

.app-notice--error {
  background: var(--color-error-light);
  color: var(--color-text-1);
}

.app-notice--error .app-notice__icon {
  color: var(--color-error);
}

.app-notice__icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.app-notice__body {
  flex: 1;
  min-width: 0;
}
</style>
