<script setup lang="ts">
/** 腰有据（占位页，后续任务按设计稿实现） */
import AppCard from '@/components/AppCard.vue'
</script>

<template>
  <AppCard>
    <h1 class="placeholder__title">腰有据</h1>
    <p class="placeholder__desc">该页面将在后续任务中按设计稿实现。</p>
  </AppCard>
</template>

<style scoped>
.placeholder__title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.placeholder__desc {
  margin: 0;
  color: var(--color-text-2);
}
</style>
