<script setup lang="ts">
/**
 * 病程（占位页）
 * 正式页面在 T22 实现：按事件记录时间线，区分自述 / 报告原文 / 医生记录；
 * 变化图不暗示影像恶化，用户可纠正、删除。
 */
import AppCard from '../../components/AppCard.vue'
import EmergencyEntry from '../../components/EmergencyEntry.vue'
import TabBar from '../../components/TabBar.vue'
</script>

<template>
  <view class="page">
    <text class="page-title">病程</text>
    <view class="gap-md" />
    <EmergencyEntry />
    <view class="gap-lg" />
    <AppCard title="占位页面" subtitle="T22 病程时间线 · 记录今天">
      <text class="placeholder-text">这里将展示按事件记录的病程时间线，区分自述、报告原文与医生记录；「记录今天」以生活任务组织，允许跳过，不复用昨日答案。</text>
    </AppCard>
    <!-- 底部导航占位 -->
    <view class="tabbar-placeholder" />
  </view>
  <TabBar current="timeline" />
</template>

<style lang="scss">
.placeholder-text {
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
}
</style>
