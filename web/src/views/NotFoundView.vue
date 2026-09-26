<script setup lang="ts">
/** 404 页面 */
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="not-found">
    <h1>页面不存在</h1>
    <p>你访问的页面不存在或已下线。</p>
    <button type="button" @click="router.push('/')">返回首页</button>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 60vh;
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
  min-height: 44px;
  padding: 10px 20px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-button);
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: var(--font-size-body);
  font-family: inherit;
  cursor: pointer;
}
</style>
