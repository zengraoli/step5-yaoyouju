<script setup lang="ts">
/** 模型与评测（占位页，后续任务按设计稿实现） */
import AppCard from '@/components/AppCard.vue'
</script>

<template>
  <AppCard>
    <h2 class="ph__title">模型与评测</h2>
    <p class="ph__desc">该页面将在后续任务中按设计稿实现。</p>
  </AppCard>
</template>

<style scoped>
.ph__title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.ph__desc {
  margin: 0;
  color: var(--color-text-2);
}
</style>
