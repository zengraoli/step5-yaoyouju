<script setup lang="ts">
/** 卡片（圆角 12，surface 底色，border 描边） */
withDefaults(defineProps<{ padded?: boolean }>(), { padded: true })
</script>

<template>
  <section class="app-card" :class="{ 'app-card--padded': padded }">
    <slot />
  </section>
</template>

<style scoped>
.app-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
}

.app-card--padded {
  padding: var(--spacing-xl);
}
</style>
