<script setup lang="ts">
/**
 * A18 服务不可用回退（设计稿 docs/design/app/A18.png，设计宽度 375）
 *
 * 模型 / 检索 / 来源校验失败时明确说明；保留已审核资料与摘要功能；
 * 不无限重试与重复计费；就医提示不依赖网络。
 *
 * 数据说明：失败原因来自一页分析任务查询（GET /analyses/task/{taskId} 的 reason），
 * 已保存信息来自服务端回退内容（fallback）；本页同时提供低带宽可读的静态结构。
 */
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import { getAnalysisTask, type AnalysisTaskView } from '../../api/analyses'
import { getStatusBarHeight } from '../../utils/system'

/** 错误码（服务端 SERVICE_UNAVAILABLE = 50300 → 展示码 ANL-503） */
const ERROR_CODE = 'ANL-503'

const statusBarHeight = ref(0)
const taskId = ref('')
const task = ref<AnalysisTaskView | null>(null)

onLoad((options) => {
  const id = (options as { task_id?: string } | undefined)?.task_id
  taskId.value = typeof id === 'string' ? id : ''
})

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  if (!taskId.value) return
  try {
    task.value = await getAnalysisTask(taskId.value)
  } catch {
    task.value = null
  }
})

/** 失败原因（服务端返回中文说明；没有时给默认说明） */
const reason = computed<string>(() => task.value?.reason ?? '模型或来源校验暂时不可用')

/** 已保存的核对信息（服务端回退内容） */
const savedKnown = computed<{ text: string; source: string }[]>(() => {
  const fallback = task.value?.fallback as { known?: { text: string; source: string }[] } | undefined
  return fallback?.known ?? []
})

/** 重试间隔提示（不无限重试） */
const RETRY_HINT = '稍后重试（约 2 分钟后可用）'

function onRetry() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/index/index' }),
  })
}

function onOpenContents() {
  uni.navigateTo({ url: '/pages/content/index' })
}

function onOpenFollowup() {
  uni.navigateTo({ url: '/pages/followup/index' })
}

function onOpenTimeline() {
  uni.reLaunch({ url: '/pages/timeline/index' })
}

function onEmergency() {
  uni.navigateTo({ url: '/pages/emergency/notice' })
}

function onBackHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page fallback-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBackHome">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">一页分析</text>
      </view>
    </view>

    <view class="fallback-body">
      <!-- 头部：本次无法完成个性化解释 -->
      <view class="hero">
        <view class="hero__icon">
          <AppIcon name="alert" :size="40" />
        </view>
        <text class="hero__title">本次无法完成个性化解释</text>
        <text class="hero__desc">
          模型或来源校验暂时不可用。我们不会无限重试，也不会重复计费。你已核对的信息已经保存，稍后可以直接生成分析。
        </text>
        <view class="hero__tags">
          <StatusTag status="self" :text="`错误码 ${ERROR_CODE}`" />
          <StatusTag status="confirmed" text="已保存核对信息" />
          <StatusTag status="confirmed" text="未计费" />
        </view>
      </view>

      <!-- 失败原因（来自服务端） -->
      <AppNotice v-if="task" type="warn">服务端说明：{{ reason }}</AppNotice>

      <!-- 现在仍然可以使用 -->
      <text class="section-title">现在仍然可以使用</text>

      <AppCard>
        <view class="usable-row" hover-class="usable-row--hover" :hover-stay-time="80" @click="onOpenContents">
          <view class="usable-row__icon usable-row__icon--play">
            <AppIcon name="play" :size="20" />
          </view>
          <view class="usable-row__body">
            <text class="usable-row__title">已审核科普</text>
            <text class="usable-row__desc">8 个视频/图文，含字幕与文字替代，不依赖模型</text>
          </view>
          <StatusTag status="confirmed" text="可用" />
        </view>

        <view class="usable-row" hover-class="usable-row--hover" :hover-stay-time="80" @click="onOpenFollowup">
          <view class="usable-row__icon usable-row__icon--file">
            <AppIcon name="file" :size="20" />
          </view>
          <view class="usable-row__body">
            <text class="usable-row__title">复诊摘要</text>
            <text class="usable-row__desc">基于你已有的记录与报告原文生成，可导出</text>
          </view>
          <StatusTag status="confirmed" text="可用" />
        </view>

        <view class="usable-row" hover-class="usable-row--hover" :hover-stay-time="80" @click="onOpenTimeline">
          <view class="usable-row__icon usable-row__icon--pulse">
            <AppIcon name="pulse" :size="20" />
          </view>
          <view class="usable-row__body">
            <text class="usable-row__title">病程记录</text>
            <text class="usable-row__desc">继续记录今天；数据只保存在你的账户</text>
          </view>
          <StatusTag status="confirmed" text="可用" />
        </view>
      </AppCard>

      <!-- 已保存的核对信息 -->
      <AppCard v-if="savedKnown.length > 0">
        <text class="section-title">已保存的核对信息</text>
        <view class="saved-list">
          <view v-for="(item, i) in savedKnown.slice(0, 5)" :key="i" class="saved-item">
            <text class="saved-item__text">{{ item.text }}</text>
            <StatusTag status="self" :text="item.source" />
          </view>
        </view>
      </AppCard>

      <!-- 低带宽说明 -->
      <AppNotice type="info">
        低带宽下本页与核心文字仍可阅读；网络异常时也能看到基础求助说明。
      </AppNotice>

      <!-- 就医提示（不依赖网络） -->
      <view class="emergency" hover-class="emergency--hover" :hover-stay-time="80" @click="onEmergency">
        <AppIcon name="alert" :size="18" />
        <text class="emergency__text">出现严重症状？查看就医提示（不依赖网络）</text>
      </view>
    </view>

    <!-- 底部操作 -->
    <view class="fallback-footer">
      <AppButton type="primary" block @click="onRetry">{{ RETRY_HINT }}</AppButton>
      <view class="fallback-footer__back" hover-class="fallback-footer__back--hover" :hover-stay-time="80" @click="onBackHome">
        <text class="fallback-footer__back-text">返回当前情况</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.fallback-page {
  min-height: 100vh;
  background-color: $color-bg;
}

.fallback-body {
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 头部 ---------- */
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $spacing-xl $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
}

.hero__icon {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background-color: $color-warn-light;
  color: $color-warn;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero__title {
  margin-top: $spacing-md;
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.hero__desc {
  margin-top: $spacing-sm;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
  text-align: center;
}

.hero__tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: $spacing-xs;
  margin-top: $spacing-md;
}

/* ---------- 段标题 ---------- */
.section-title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  margin-bottom: $spacing-sm;
}

/* ---------- 可用功能 ---------- */
.usable-row {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-md 0;
  border-top: 2rpx solid $color-border;

  &:first-child {
    border-top: none;
    padding-top: 0;
  }

  &--hover {
    opacity: 0.85;
  }
}

.usable-row__icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: $radius-button;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &--play {
    background-color: $color-primary-light;
    color: $color-primary;
  }

  &--file {
    background-color: $color-info-light;
    color: $color-info;
  }

  &--pulse {
    background-color: $color-ok-light;
    color: $color-ok;
  }
}

.usable-row__body {
  flex: 1;
  min-width: 0;
}

.usable-row__title {
  display: block;
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.usable-row__desc {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 已保存信息 ---------- */
.saved-list {
  display: flex;
  flex-direction: column;
}

.saved-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $spacing-sm;
  padding: $spacing-sm 0;
  border-top: 2rpx solid $color-border;

  &:first-child {
    border-top: none;
  }
}

.saved-item__text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- 就医提示 ---------- */
.emergency {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  min-height: 88rpx;
  padding: 0 $spacing-lg;
  background-color: $color-error-light;
  border: 2rpx solid $color-error;
  border-radius: $radius-card;
  color: $color-error;

  &--hover {
    opacity: 0.85;
  }
}

.emergency__text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-error;
}

/* ---------- 底部 ---------- */
.fallback-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  background-color: $color-surface;
  border-top: 2rpx solid $color-border;
}

.fallback-footer__back {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &--hover {
    opacity: 0.7;
  }
}

.fallback-footer__back-text {
  font-size: $font-size-body;
  color: $color-primary;
}
</style>
