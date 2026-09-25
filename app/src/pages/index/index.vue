<script setup lang="ts">
/**
 * 首页 · 当前情况（占位演示页）
 * 演示主题变量与通用组件（按钮四种 / 芯片 / 状态标签 / 提示条三种 / 卡片），
 * 并对接接口自检（/switches 公开接口 + 登录态展示）；正式页面在 T17 按 A14 还原。
 */
import { onMounted, ref } from 'vue'
import AppCard from '../../components/AppCard.vue'
import AppButton from '../../components/AppButton.vue'
import AppChip from '../../components/AppChip.vue'
import StatusTag, { type StatusKey } from '../../components/StatusTag.vue'
import AppNotice from '../../components/AppNotice.vue'
import EmergencyEntry from '../../components/EmergencyEntry.vue'
import { getSwitches } from '../../api/switches'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()

/* ---- 组件演示状态 ---- */
type ChipState = 'selected' | 'unselected' | 'skipped'
const chipState = ref<ChipState>('unselected')
const chipLabel = ref('会阴部麻木')
const loading = ref(false)

const STATUS_LIST: StatusKey[] = [
  'confirmed',
  'unconfirmed',
  'conflict',
  'unverified',
  'quote',
  'self',
  'generated',
  'reviewed',
  'offline',
  'no-diagnosis',
]

function onChipClick() {
  chipState.value = chipState.value === 'selected' ? 'unselected' : 'selected'
}

function onSkipChip() {
  chipState.value = 'skipped'
}

function onLoadingDemo() {
  loading.value = true
  setTimeout(() => {
    loading.value = false
    uni.showToast({ title: '提交完成（演示）', icon: 'none' })
  }, 800)
}

/* ---- 接口自检 ---- */
const switchCheck = ref({ ok: false, text: '检查中…' })

onMounted(async () => {
  try {
    const list = await getSwitches()
    switchCheck.value = { ok: true, text: `接口正常，读取到 ${list.length} 个功能开关` }
  } catch (e) {
    switchCheck.value = { ok: false, text: e instanceof Error ? e.message : '接口不可用' }
  }
})
</script>

<template>
  <view class="page">
    <text class="page-title">当前情况</text>
    <view class="gap-md" />
    <EmergencyEntry />

    <!-- 按钮：四种类型 + disabled / loading -->
    <view class="gap-lg" />
    <AppCard title="按钮" subtitle="主按钮 / 次按钮 / 柔和 / 危险 · 就医；最小点击区域 44×44，圆角 10">
      <view class="demo-row">
        <AppButton type="primary">主按钮</AppButton>
        <AppButton type="secondary">次按钮</AppButton>
      </view>
      <view class="gap-sm" />
      <view class="demo-row">
        <AppButton type="soft">柔和</AppButton>
        <AppButton type="danger" icon="alert">危险 · 就医</AppButton>
      </view>
      <view class="gap-sm" />
      <view class="demo-row">
        <AppButton type="primary" :loading="loading" @click="onLoadingDemo">提交</AppButton>
        <AppButton type="primary" disabled>不可用</AppButton>
      </view>
    </AppCard>

    <!-- 芯片：已选 / 未选 / 跳过 -->
    <view class="gap-lg" />
    <AppCard title="芯片" subtitle="已选 / 未选 / 跳过；跳过不视为阴性">
      <view class="demo-row">
        <AppChip :label="chipLabel" :state="chipState" @click="onChipClick" />
        <AppChip label="双腿进行性无力" state="unselected" @click="onSkipChip" />
        <AppChip label="已跳过项" state="skipped" />
      </view>
    </AppCard>

    <!-- 状态标签：三端语义一致 -->
    <view class="gap-lg" />
    <AppCard title="状态标签" subtitle="文案与语义三端一致">
      <view class="demo-tags">
        <StatusTag v-for="key in STATUS_LIST" :key="key" :status="key" />
      </view>
    </AppCard>

    <!-- 提示条：信息 / 提醒 / 就医 -->
    <view class="gap-lg" />
    <AppCard title="提示条" subtitle="信息提示 / 提醒 / 就医提示（就医提示不阻断操作）">
      <AppNotice type="info" title="信息提示">报告原文已保存，可随时在原文对照中查看。</AppNotice>
      <view class="gap-sm" />
      <AppNotice type="warn" title="提醒">这一项还没有确认，我们不会替你默认为「无」。</AppNotice>
      <view class="gap-sm" />
      <AppNotice type="error" title="需要及时寻求专业帮助">
        这类变化需要医生及时评估，本产品无法替你判断严重程度。
      </AppNotice>
    </AppCard>

    <!-- 接口与登录态自检 -->
    <view class="gap-lg" />
    <AppCard title="接口与登录态" subtitle="数据来自 server，不写死在页面里">
      <view class="demo-row">
        <StatusTag :status="switchCheck.ok ? 'confirmed' : 'conflict'" :text="switchCheck.ok ? '接口正常' : '接口异常'" />
        <text class="aux-text">{{ switchCheck.text }}</text>
      </view>
      <view class="gap-sm" />
      <view class="demo-row">
        <StatusTag :status="auth.isLoggedIn ? 'confirmed' : 'unconfirmed'" :text="auth.isLoggedIn ? '已登录' : '未登录'" />
        <text class="aux-text">{{ auth.isLoggedIn ? auth.phoneMasked : '登录页在 T17 实现' }}</text>
      </view>
      <view class="gap-sm" />
      <text class="aux-text">API 基础地址：http://127.0.0.1:3200（可在「我的」页切换）</text>
    </AppCard>

    <view class="gap-xl" />
  </view>
</template>

<style lang="scss">
.demo-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: $spacing-sm;
}

.demo-tags {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
}
</style>
