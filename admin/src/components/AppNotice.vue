<script setup lang="ts">
/** 提示条：信息 / 提醒 / 危险 */
withDefaults(defineProps<{ type?: 'info' | 'warn' | 'error' }>(), { type: 'info' })
</script>

<template>
  <div class="app-notice" :class="`app-notice--${type}`">
    <span class="app-notice__icon" aria-hidden="true">{{ type === 'info' ? 'i' : '!' }}</span>
    <div class="app-notice__body"><slot /></div>
  </div>
</template>

<style scoped>
.app-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-button);
  font-size: var(--font-size-aux-sm);
  line-height: var(--line-height-body);
}

.app-notice--info {
  background: var(--color-info-light);
  color: var(--color-text-1);
}

.app-notice--warn {
  background: var(--color-warn-light);
  color: var(--color-text-1);
}

.app-notice--error {
  background: var(--color-error-light);
  color: var(--color-text-1);
}

.app-notice__icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  color: #fff;
  flex-shrink: 0;
  margin-top: 2px;
}

.app-notice--info .app-notice__icon {
  background: var(--color-info);
}

.app-notice--warn .app-notice__icon {
  background: var(--color-warn);
}

.app-notice--error .app-notice__icon {
  background: var(--color-error);
}

.app-notice__body {
  flex: 1;
  min-width: 0;
}
</style>
