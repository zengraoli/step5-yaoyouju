<script setup lang="ts">
/** 404 */
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="not-found">
    <h1>页面不存在</h1>
    <button type="button" @click="router.push('/')">返回仪表盘</button>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 50vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  color: var(--color-text-2);
}

.not-found h1 {
  font-size: var(--font-size-page-title);
  color: var(--color-text-1);
  margin: 0;
}

.not-found button {
  min-height: 36px;
  padding: 6px 16px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-button);
  background: var(--color-surface);
  color: var(--color-primary);
  cursor: pointer;
}
</style>
