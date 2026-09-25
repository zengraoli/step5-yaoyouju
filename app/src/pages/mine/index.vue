<script setup lang="ts">
/**
 * 我的（占位页）
 * 正式页面在 T25 实现：数据与授权（同意记录可查可撤回、导出与删除）、
 * 反馈与举报、服务不可用回退、API 基础地址切换。
 */
import AppCard from '../../components/AppCard.vue'
import AppButton from '../../components/AppButton.vue'
import EmergencyEntry from '../../components/EmergencyEntry.vue'
import { getBaseUrl, setBaseUrl } from '../../api/request'

/** 切换 API 基础地址（演示用：指向本地 server 3200） */
function onResetBaseUrl() {
  setBaseUrl('http://127.0.0.1:3200')
  uni.showToast({ title: '已恢复默认地址', icon: 'none' })
}
</script>

<template>
  <view class="page">
    <text class="page-title">我的</text>
    <view class="gap-md" />
    <EmergencyEntry />
    <view class="gap-lg" />
    <AppCard title="占位页面" subtitle="T25 我的 · 数据与授权">
      <text class="placeholder-text">这里将展示同意记录（可查、可撤回）、导出与删除、反馈与举报进度、服务边界说明。</text>
      <view class="gap-md" />
      <text class="aux-text">当前 API 基础地址：{{ getBaseUrl() }}</text>
      <view class="gap-sm" />
      <AppButton type="secondary" @click="onResetBaseUrl">恢复默认地址</AppButton>
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
