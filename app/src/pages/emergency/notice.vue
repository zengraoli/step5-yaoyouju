<script setup lang="ts">
/**
 * 就医提示页（占位页）
 * 对应 A03：红旗信号直接提示；不被注册、付费、上传或长问卷阻断；
 * 本轮不生成个性化分析。内容优先来自 server /safety/emergency-notice，
 * 网络异常时展示本页静态兜底内容（产品红线：本页始终可达）。
 */
import { onMounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { getEmergencyNotice, type EmergencyNotice } from '../../api/safety'

/** 网络异常时的静态兜底内容（与接口返回一致的演示文案） */
const FALLBACK: EmergencyNotice = {
  title: '需要及时寻求专业帮助',
  headline: '建议尽快就医',
  body: '你刚才选择了需要医生及时评估的变化。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。',
  offline_note: '本页在网络异常时也可查看。',
  actions: [
    { type: 'call', label: '拨打 120 / 前往急诊' },
    { type: 'hospital', label: '查找附近医院' },
    { type: 'doctor', label: '联系我的主治医生（已保存）' },
  ],
  bring_list: ['已录入的检查报告原文', '症状开始时间与最近变化记录', '正在使用的药物与既有医嘱'],
  summary_action: { label: '生成一页“就诊交接”摘要（仅整理已有信息）' },
  footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
}

const notice = ref<EmergencyNotice | null>(null)
const loading = ref(true)
const fromApi = ref(false)

onMounted(async () => {
  try {
    notice.value = await getEmergencyNotice()
    fromApi.value = true
  } catch {
    // 网络异常：使用静态兜底内容，本页不被网络阻断
    notice.value = FALLBACK
    fromApi.value = false
  } finally {
    loading.value = false
  }
})

/** 就医动作（演示环境不真正拨号） */
function onAction(label: string) {
  uni.showToast({ title: `演示环境：${label}`, icon: 'none' })
}

function onSummary() {
  uni.showToast({ title: '就诊交接摘要在复诊准备中生成', icon: 'none' })
}
</script>

<template>
  <view class="page notice-page">
    <view v-if="loading" class="aux-text">加载中…</view>
    <template v-else-if="notice">
      <text class="page-title">{{ notice.title }}</text>
      <view class="gap-md" />
      <view class="demo-row">
        <StatusTag status="no-diagnosis" text="不作诊断" />
        <StatusTag :status="fromApi ? 'quote' : 'unverified'" :text="fromApi ? '报告原文' : '未经核实'" />
      </view>
      <view class="gap-md" />
      <view class="notice-headline">{{ notice.headline }}</view>
      <view class="gap-sm" />
      <text class="notice-body">{{ notice.body }}</text>

      <view class="gap-lg" />
      <AppButton v-for="a in notice.actions" :key="a.type" type="danger" block icon="phone" @click="onAction(a.label)">
        {{ a.label }}
      </AppButton>

      <view class="gap-lg" />
      <AppCard title="就诊时请带上" subtitle="仅整理你已录入的信息">
        <view v-for="(item, i) in notice.bring_list" :key="i" class="bring-item">
          <text class="bring-dot">·</text>
          <text class="bring-text">{{ item }}</text>
        </view>
      </AppCard>

      <view class="gap-md" />
      <AppButton type="secondary" block @click="onSummary">{{ notice.summary_action.label }}</AppButton>

      <view class="gap-md" />
      <text class="aux-text">{{ notice.offline_note }}</text>
      <view class="gap-sm" />
      <text class="aux-text">{{ notice.footer_note }}</text>
    </template>

    <!-- 底部导航：非 tab 页保持五个入口可达 -->
    <view class="tabbar-placeholder" />
  </view>
  <TabBar />
</template>

<style lang="scss">
.notice-page {
  padding-bottom: 0;
}

.notice-headline {
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-error;
  line-height: 1.4;
}

.notice-body {
  display: block;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.bring-item {
  display: flex;
  gap: $spacing-sm;

  & + & {
    margin-top: $spacing-xs;
  }
}

.bring-dot {
  color: $color-text-3;
}

.bring-text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
}
</style>
