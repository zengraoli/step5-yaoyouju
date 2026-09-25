<script setup lang="ts">
/**
 * 问与解释（占位页）
 * 正式页面在 T21 实现：基于当前上下文提问，每条解释可见来源；
 * 越界问题明确不答，可转为复诊问题。
 */
import AppCard from '../../components/AppCard.vue'
import EmergencyEntry from '../../components/EmergencyEntry.vue'
</script>

<template>
  <view class="page">
    <text class="page-title">问与解释</text>
    <view class="gap-md" />
    <EmergencyEntry />
    <view class="gap-lg" />
    <AppCard title="占位页面" subtitle="T21 问与解释">
      <text class="placeholder-text">这里将展示基于当前情况的对话：每条解释都能看到来源，系统生成内容带版本号；越界问题（诊断、用药、手术）明确不答，可转为复诊问题。</text>
    </AppCard>
  </view>
</template>

<style lang="scss">
.placeholder-text {
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
}
</style>
