<script setup lang="ts">
/**
 * A17 我的 · 数据与授权（设计稿 docs/design/app/A17.png，设计宽度 375，主 Tab）
 *
 * 同意记录可查可撤回；导出与删除；身份与分析分离；服务边界可见。
 *
 * 数据全部来自 server 接口：
 * - GET  /auth/me                      当前用户（脱敏手机号）
 * - GET  /auth/consents                同意记录
 * - POST /auth/consents/:scope/revoke  撤回同意（立即生效）
 * - GET  /safety/emergency-notice      紧急就医提示（公开）
 */
import { computed, onMounted, ref } from 'vue';
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { useAuthStore } from '../../stores/auth'
import { listConsents, me, revokeConsent, type ConsentItem } from '../../api/auth'
import { getStatusBarHeight } from '../../utils/system'

/** 版本信息（按设计稿） */
const VERSION_INFO = 'App v0.1.0 · 分析模型 M-2609 · 内容库 2026-09'

const auth = useAuthStore()
const statusBarHeight = ref(0)
const phoneMasked = ref('')
const consents = ref<ConsentItem[]>([])
const loading = ref(true)

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  await load()
})

async function load() {
  loading.value = true
  try {
    const profile = await me()
    phoneMasked.value = profile.phone_masked
    consents.value = await listConsents()
  } catch {
    // 保留已缓存的登录态信息
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/* ---------- 派生数据 ---------- */

/** 健康信息处理同意状态 */
const healthConsent = computed<ConsentItem | undefined>(() =>
  consents.value.find((c) => c.scope === '健康信息处理'),
)

const consentSummary = computed<string>(() => {
  const parts: string[] = []
  const health = healthConsent.value
  parts.push(
    health?.granted
      ? `健康信息处理：已同意 ${health.granted_at.slice(0, 10)}`
      : '健康信息处理：未同意',
  )
  const others = consents.value.filter((c) => c.scope !== '健康信息处理')
  const granted = others.filter((c) => c.granted).map((c) => c.scope)
  parts.push(granted.length > 0 ? `${granted.join('/')}：已开启` : '分享/产品改进：未开启')
  return parts.join(' · ')
})

/** 匿名标识（脱敏展示；真实标识不与分析内容关联存储） */
const anonymousId = computed<string>(() => {
  const id = auth.userId ?? ''
  if (!id) return ''
  return `U-${id.slice(0, 4).toUpperCase()}…`
})

/* ---------- 操作 ---------- */

async function onRevokeHealth() {
  uni.showModal({
    title: '撤回「处理健康信息」的同意',
    content: '撤回后将停止个性化分析；已审核科普与已导出的摘要仍可使用。确定撤回吗？',
    confirmText: '撤回',
    confirmColor: '#D93B3B',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await revokeConsent('健康信息处理')
        await load()
        toast('已撤回同意，个性化分析已停止')
      } catch (e) {
        toast(e instanceof Error ? e.message : '撤回失败，请稍后重试')
      }
    },
  })
}

function onExportData() {
  uni.showToast({ title: '导出任务已创建，完成后可在站内查收（演示）', icon: 'none' })
}

function onDeleteAccount() {
  uni.showModal({
    title: '删除账户与数据',
    content: '删除会覆盖公开卡片、搜索索引、向量、缓存与派生摘要；依法需要保留的信息按政策管理，不承诺瞬时全网删除。',
    confirmText: '删除',
    confirmColor: '#D93B3B',
    success: (res) => {
      if (res.confirm) toast('演示实现：删除任务已记录，稍后由合规人员处理')
    },
  })
}

function onCaseSubmission() {
  uni.showToast({ title: '案例投稿为二期预留，尚未开放', icon: 'none' })
}

function onServiceScope() {
  uni.showToast({ title: '不作诊断、不给手术判断、不调整药物、不生成严重程度总评', icon: 'none' })
}

function onEmergency() {
  uni.navigateTo({ url: '/pages/emergency/notice' })
}

function onReviewPolicy() {
  uni.showToast({ title: '谁审核了内容、依据是什么、如何举报错误', icon: 'none' })
}

function onVersionInfo() {
  uni.showToast({ title: VERSION_INFO, icon: 'none' })
}

function onConsentRecords() {
  uni.showToast({ title: consentSummary.value, icon: 'none' })
}

async function onLogout() {
  await auth.logout()
  uni.reLaunch({ url: '/pages/login/login' })
}

function onSettings() {
  uni.showToast({ title: '设置功能将在后续版本提供', icon: 'none' })
}
</script>

<template>
  <view class="page mine-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <text class="nav__title">我的</text>
        <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80" @click="onSettings">
          <AppIcon name="gear" :size="22" />
        </view>
      </view>
    </view>

    <view class="mine-body">
      <!-- 用户卡片 -->
      <AppCard>
        <view class="user">
          <view class="user__avatar">
            <text class="user__avatar-text">U</text>
          </view>
          <view class="user__info">
            <text class="user__phone">{{ phoneMasked || auth.phoneMasked || '未登录' }}</text>
            <text class="user__anon">
              匿名内部标识 {{ anonymousId || '尚未确认' }}…（分析内容与身份信息分离存储）
            </text>
          </view>
        </view>
      </AppCard>

      <!-- 数据与授权 -->
      <AppCard>
        <text class="card-group-title">数据与授权</text>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onConsentRecords">
          <view class="row__icon row__icon--shield">
            <AppIcon name="shield" :size="20" />
          </view>
          <view class="row__body">
            <view class="row__title-line">
              <text class="row__title">我的同意记录</text>
              <StatusTag status="confirmed" text="可撤回" />
            </view>
            <text class="row__desc">{{ consentSummary || '正在加载…' }}</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onRevokeHealth">
          <view class="row__icon row__icon--close">
            <AppIcon name="close" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">撤回“处理健康信息”的同意</text>
            <text class="row__desc">撤回后停止个性化分析，已审核科普与已导出摘要仍可用</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onExportData">
          <view class="row__icon row__icon--download">
            <AppIcon name="download" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">导出我的全部数据</text>
            <text class="row__desc">可读格式（PDF / JSON），包含病程、报告原文与分析版本</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onDeleteAccount">
          <view class="row__icon row__icon--delete">
            <AppIcon name="trash" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title row__title--danger">删除账户与数据</text>
            <text class="row__desc">覆盖公开卡片、搜索索引、向量、缓存与派生摘要</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>
      </AppCard>

      <!-- 分享与社区 -->
      <AppCard>
        <text class="card-group-title">分享与社区</text>
        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onCaseSubmission">
          <view class="row__icon row__icon--community">
            <AppIcon name="user" :size="20" />
          </view>
          <view class="row__body">
            <view class="row__title-line">
              <text class="row__title">案例投稿（二期）</text>
              <StatusTag status="offline" text="尚未开放" />
            </view>
            <text class="row__desc">单独授权 · 预览 · 去除第三方信息 · 人工审核 · 可撤回</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>
      </AppCard>

      <!-- 服务信息 -->
      <AppCard>
        <text class="card-group-title">服务信息</text>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onServiceScope">
          <view class="row__icon row__icon--info">
            <AppIcon name="info" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">服务范围与不做的事</text>
            <text class="row__desc">不作诊断、不给手术判断、不调整药物、不生成严重程度总评</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onEmergency">
          <view class="row__icon row__icon--alert">
            <AppIcon name="alert" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title row__title--danger">紧急就医提示</text>
            <text class="row__desc">无需登录，网络异常时也可查看</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onReviewPolicy">
          <view class="row__icon row__icon--file">
            <AppIcon name="file" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">临床审定与来源说明</text>
            <text class="row__desc">谁审核了内容、依据是什么、如何举报错误</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onVersionInfo">
          <view class="row__icon row__icon--gear">
            <AppIcon name="gear" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">版本信息</text>
            <text class="row__desc">{{ VERSION_INFO }}</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>
      </AppCard>

      <!-- 退出登录 -->
      <view class="logout" hover-class="logout--hover" :hover-stay-time="80" @click="onLogout">
        <AppIcon name="logout" :size="18" />
        <text class="logout__text">退出登录</text>
      </view>

      <!-- 删除说明 -->
      <AppNotice type="warn">
        删除会覆盖公开卡片、搜索索引、向量、缓存和派生摘要；备份与依法需要保留的信息按政策管理，不承诺瞬时全网删除。
      </AppNotice>
    </view>

    <TabBar />
  </view>
</template>

<style lang="scss">
.mine-page {
  min-height: 100vh;
  background-color: $color-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 120rpx);
}

.mine-body {
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 用户卡片 ---------- */
.user {
  display: flex;
  align-items: center;
}

.user__avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background-color: $color-primary-light;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user__avatar-text {
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-primary;
}

.user__info {
  flex: 1;
  margin-left: $spacing-md;
  min-width: 0;
}

.user__phone {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.user__anon {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 分组标题 ---------- */
.card-group-title {
  display: block;
  font-size: $font-size-aux;
  color: $color-text-3;
  margin-bottom: $spacing-sm;
}

/* ---------- 行 ---------- */
.row {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-md 0;
  border-top: 2rpx solid $color-border;

  &:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  &--hover {
    opacity: 0.85;
  }
}

.row__icon {
  width: 56rpx;
  height: 56rpx;
  border-radius: $radius-button;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &--shield {
    background-color: $color-info-light;
    color: $color-info;
  }

  &--close {
    background-color: $color-warn-light;
    color: $color-warn;
  }

  &--download {
    background-color: $color-primary-light;
    color: $color-primary;
  }

  &--delete {
    background-color: $color-error-light;
    color: $color-error;
  }

  &--community {
    background-color: $color-neutral-light;
    color: $color-text-2;
  }

  &--info {
    background-color: $color-info-light;
    color: $color-info;
  }

  &--alert {
    background-color: $color-error-light;
    color: $color-error;
  }

  &--file {
    background-color: $color-primary-light;
    color: $color-primary;
  }

  &--gear {
    background-color: $color-neutral-light;
    color: $color-text-2;
  }
}

.row__body {
  flex: 1;
  min-width: 0;
}

.row__title-line {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.row__title {
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  color: $color-text-1;

  &--danger {
    color: $color-error;
  }
}

.row__desc {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 退出登录 ---------- */
.logout {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-xs;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
  color: $color-primary;

  &--hover {
    opacity: 0.8;
  }
}

.logout__text {
  font-size: $font-size-body;
  color: $color-primary;
}
</style>
