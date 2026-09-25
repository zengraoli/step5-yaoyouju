<script setup lang="ts">
/**
 * 复诊准备（占位页）
 * 正式页面在 T23 实现：复诊摘要预览与导出（固定六段，区分自述 / 原文 / 医生记录）。
 */
import AppCard from '../../components/AppCard.vue'
import EmergencyEntry from '../../components/EmergencyEntry.vue'
</script>

<template>
  <view class="page">
    <text class="page-title">复诊准备</text>
    <view class="gap-md" />
    <EmergencyEntry />
    <view class="gap-lg" />
    <AppCard title="占位页面" subtitle="T23 复诊摘要预览与导出">
      <text class="placeholder-text">这里将展示复诊摘要预览与导出：固定六段结构，区分自述、报告原文与医生记录；未核实项保留，用户预览后自主导出。</text>
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
