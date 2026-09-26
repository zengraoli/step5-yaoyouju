<script setup lang="ts">
/**
 * A04 选择主要困惑（设计稿 docs/design/app/A04.png，设计宽度 375，第 2/4 步）
 *
 * 用户主动选择困扰点与解释方式；系统按选择调整解释的重点、长度和形式。
 * 选择只影响解释的呈现，不构成诊断，也不给用户贴标签。
 *
 * 数据说明：困惑与解释方式保存在本地（uni.storage），供 A06 核对页展示；
 * 一页分析的生成由 server 完成（POST /analyses），本页不直接调用接口。
 */
import { ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppIcon from '../../components/AppIcon.vue'
import { getStatusBarHeight } from '../../utils/system'

/** 四个主要困惑（文案按设计稿） */
const CONFUSIONS = [
  { key: 'report', title: '报告术语', desc: '看懂报告里写的是什么、哪些结论不能得出', icon: 'report' },
  { key: 'course', title: '病程变化', desc: '这段时间的变化意味着什么、哪些值得记录', icon: 'pulse' },
  { key: 'followup', title: '复诊准备', desc: '复诊时该问什么、带什么、怎么描述', icon: 'clipboard' },
  { key: 'life', title: '生活影响', desc: '日常活动、工作与睡眠要注意什么', icon: 'heart' },
] as const

/** 希望的解釋方式（可多选；「简短要点」默认选中） */
const EXPLAIN_WAYS = ['简短要点', '详细说明', '带图示视频', '先看原文对照'] as const

/** 本地存储键：主要困惑与解释方式（会话内偏好，不涉及健康数据上传） */
const STORAGE_KEY = 'yyj_confusion'

interface ConfusionPref {
  confusion: string
  ways: string[]
}

const statusBarHeight = ref(0)
const confusion = ref('')
const ways = ref<string[]>(['简短要点'])

statusBarHeight.value = getStatusBarHeight()

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

function onPickConfusion(key: string) {
  confusion.value = confusion.value === key ? '' : key
}

function onToggleWay(way: string) {
  ways.value = ways.value.includes(way)
    ? ways.value.filter((w) => w !== way)
    : [...ways.value, way]
}

/** 下一步：保存偏好 → 进入 A05 录入报告与医嘱 */
function onNext() {
  if (!confusion.value) {
    toast('请选择一个最困扰你的问题（可稍后更改）')
    return
  }
  const pref: ConfusionPref = { confusion: confusion.value, ways: ways.value }
  uni.setStorageSync(STORAGE_KEY, pref)
  uni.navigateTo({ url: '/pages/report/input' })
}

function onBack() {
  uni.navigateBack({
    fail: () => {
      uni.reLaunch({ url: '/pages/index/index' })
    },
  })
}
</script>

<template>
  <view class="page confusion-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">你现在最想解决什么</text>
        <view class="nav__step">
          <text class="nav__step-text">第 2/4 步</text>
        </view>
      </view>
    </view>

    <view class="confusion-body">
      <!-- 引导语 -->
      <text class="confusion-intro">
        选择一个最困扰你的问题（可稍后更改）。系统会按你的选择调整解释的重点、长度和形式。
      </text>

      <!-- 四个困惑选项 -->
      <view class="option-list">
        <view
          v-for="item in CONFUSIONS"
          :key="item.key"
          class="option-card"
          :class="{ 'option-card--selected': confusion === item.key }"
          hover-class="option-card--hover"
          :hover-stay-time="80"
          @click="onPickConfusion(item.key)"
        >
          <view class="option-card__icon" :class="{ 'option-card__icon--selected': confusion === item.key }">
            <AppIcon :name="item.icon" :size="26" />
          </view>
          <view class="option-card__text">
            <text class="option-card__title">{{ item.title }}</text>
            <text class="option-card__desc">{{ item.desc }}</text>
          </view>
          <view class="option-card__radio" :class="{ 'option-card__radio--selected': confusion === item.key }">
            <AppIcon v-if="confusion === item.key" name="check" :size="14" />
          </view>
        </view>
      </view>

      <!-- 希望的解释方式 -->
      <view class="ways-card">
        <text class="ways-card__title">希望的解释方式</text>
        <view class="ways-card__chips">
          <view
            v-for="way in EXPLAIN_WAYS"
            :key="way"
            class="way-chip"
            :class="{ 'way-chip--selected': ways.includes(way) }"
            hover-class="way-chip--hover"
            :hover-stay-time="80"
            @click="onToggleWay(way)"
          >
            <text class="way-chip__text">{{ way }}</text>
          </view>
        </view>
        <text class="ways-card__note">不会根据你的选择给你贴任何标签，也不会为了让你更安心而改写事实。</text>
      </view>
    </view>

    <!-- 底部操作 -->
    <view class="confusion-footer">
      <AppButton type="primary" block @click="onNext">下一步</AppButton>
    </view>
  </view>
</template>

<style lang="scss">
.confusion-page {
  min-height: 100vh;
  background-color: $color-bg;
  display: flex;
  flex-direction: column;
}

.confusion-body {
  flex: 1;
  padding: $spacing-lg $spacing-page 0;
}

.confusion-intro {
  display: block;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
  margin-bottom: $spacing-lg;
}

/* ---------- 困惑选项 ---------- */
.option-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
}

.option-card {
  display: flex;
  align-items: center;
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
  transition: border-color 0.15s, background-color 0.15s;

  &--selected {
    border-color: $color-primary;
    background-color: $color-primary-light;
  }

  &--hover {
    opacity: 0.85;
  }
}

.option-card__icon {
  width: 72rpx;
  height: 72rpx;
  border-radius: $radius-button;
  background-color: $color-bg;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-primary;
  flex-shrink: 0;

  &--selected {
    background-color: $color-primary;
    color: $color-surface;
  }
}

.option-card__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-left: $spacing-md;
  min-width: 0;
}

.option-card__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.4;
}

.option-card__desc {
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

.option-card__radio {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid $color-text-3;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: $color-surface;

  &--selected {
    background-color: $color-primary;
    border-color: $color-primary;
  }
}

/* ---------- 希望的解释方式 ---------- */
.ways-card {
  margin-top: $spacing-lg;
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
}

.ways-card__title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.ways-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

.way-chip {
  min-height: 56rpx;
  padding: $spacing-xs $spacing-lg;
  border-radius: $radius-tag;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  display: flex;
  align-items: center;
  justify-content: center;

  &--selected {
    background-color: $color-primary;
    border-color: $color-primary;
  }

  &--hover {
    opacity: 0.85;
  }
}

.way-chip__text {
  font-size: $font-size-body;
  color: $color-text-1;

  .way-chip--selected & {
    color: $color-surface;
    font-weight: $font-weight-medium;
  }
}

.ways-card__note {
  display: block;
  margin-top: $spacing-md;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 底部操作 ---------- */
.confusion-footer {
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  background-color: $color-surface;
  border-top: 2rpx solid $color-border;
}
</style>
