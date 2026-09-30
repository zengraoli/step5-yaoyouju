<script setup lang="ts">
/** 轻提示容器：全局挂一个即可（App.vue） */
import { toastItems } from '@/composables/useToast'
</script>

<template>
  <div class="toast-layer" aria-live="polite">
    <div v-for="t in toastItems" :key="t.id" class="toast" :class="`toast--${t.type}`" role="status">
      {{ t.message }}
    </div>
  </div>
</template>

<style scoped>
.toast-layer {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 60;
  pointer-events: none;
}
.toast {
  max-width: 480px;
  padding: 10px 16px;
  border-radius: var(--radius-button);
  background: var(--color-text-1);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 6px 20px rgb(15 34 54 / 18%);
}
.toast--warn {
  background: var(--color-warn);
}
.toast--error {
  background: var(--color-error);
}
</style>
