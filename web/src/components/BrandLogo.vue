<script setup lang="ts">
/**
 * 品牌标识（自绘 SVG 方块「腰」字 + 品牌名）
 * 不加载任何外部资源。
 */
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg'; showName?: boolean }>(), {
  size: 'md',
  showName: true,
})
</script>

<template>
  <div class="brand" :class="`brand--${size}`">
    <div class="brand__logo">
      <span class="brand__logo-text">腰</span>
    </div>
    <span v-if="showName" class="brand__name">腰有据</span>
  </div>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-md);
}

.brand__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  color: var(--color-surface);
  border-radius: 20%;
  font-weight: var(--font-weight-medium);
  flex-shrink: 0;
}

.brand--sm .brand__logo {
  width: 32px;
  height: 32px;
  font-size: 16px;
}

.brand--md .brand__logo {
  width: 48px;
  height: 48px;
  font-size: 24px;
}

.brand--lg .brand__logo {
  width: 64px;
  height: 64px;
  font-size: 32px;
}

.brand__name {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-1);
}

.brand--sm .brand__name {
  font-size: var(--font-size-card-title);
}

.brand--md .brand__name {
  font-size: var(--font-size-page-title);
}

.brand--lg .brand__name {
  font-size: 24px;
}
</style>
