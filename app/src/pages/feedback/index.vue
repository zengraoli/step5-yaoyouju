<script setup lang="ts">
/**
 * 反馈与错误举报（占位页）
 *
 * 说明：A07「一页分析」的「报告错误」入口跳转本页。完整的 A16 反馈与错误举报
 * 界面（自动附带四类版本、分类举报、单条授权查看）在 T25 按设计稿实现。
 *
 * 当前可用：帮助类型反馈已在一页分析页内完成（POST /feedback）；
 * 错误举报需要分类与描述，本页先提供最小可用入口（POST /feedback/error-report）。
 */
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import { REPORT_CATEGORIES, submitErrorReport } from '../../api/feedback'
import { getStatusBarHeight } from '../../utils/system'

const statusBarHeight = ref(0)
const analysisId = ref('')
const category = ref<string>(REPORT_CATEGORIES[0])
const description = ref('')
const submitting = ref(false)

onLoad((options) => {
  statusBarHeight.value = getStatusBarHeight()
  const id = (options as { analysis_id?: string } | undefined)?.analysis_id
  analysisId.value = typeof id === 'string' ? id : ''
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

async function onSubmit() {
  if (submitting.value) return
  if (!description.value.trim()) {
    toast('请简单描述你发现的问题')
    return
  }
  submitting.value = true
  try {
    await submitErrorReport({
      analysis_id: analysisId.value || undefined,
      category: category.value,
      description: description.value.trim(),
      severity: 'medium',
    })
    toast('已收到举报（会自动附带分析、模型、内容、规则集四类版本）')
    uni.navigateBack()
  } catch (e) {
    toast(e instanceof Error ? e.message : '提交失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

function onBack() {
  uni.navigateBack()
}
</script>

<template>
  <view class="page feedback-page">
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">反馈与错误举报</text>
      </view>
    </view>

    <view class="feedback-body">
      <AppNotice type="info">
        举报会自动附带分析版本、模型版本、内容版本与规则集版本，便于定位；反馈与举报不会自动进入训练或内容库。
      </AppNotice>

      <view class="card">
        <text class="card__label">举报分类</text>
        <view class="chips">
          <view
            v-for="item in REPORT_CATEGORIES"
            :key="item"
            class="chip"
            :class="{ 'chip--selected': category === item }"
            hover-class="chip--hover"
            :hover-stay-time="80"
            @click="category = item"
          >
            <text class="chip__text">{{ item }}</text>
          </view>
        </view>

        <text class="card__label">问题描述</text>
        <textarea
          v-model="description"
          class="textarea"
          placeholder="请描述哪里不对（例如：解释与报告原文不一致）"
          placeholder-class="textarea__placeholder"
          :maxlength="500"
        />
      </view>

      <AppButton type="primary" block :loading="submitting" @click="onSubmit">提交举报</AppButton>
      <text class="feedback-note">完整的反馈与举报界面（含处理进度）将在后续版本提供。</text>
    </view>
  </view>
</template>

<style lang="scss">
.feedback-page {
  min-height: 100vh;
  background-color: $color-bg;
}

.feedback-body {
  padding: $spacing-lg $spacing-page;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

.card {
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
}

.card__label {
  display: block;
  font-size: $font-size-aux;
  color: $color-text-2;
  margin-bottom: $spacing-sm;

  &:not(:first-child) {
    margin-top: $spacing-lg;
  }
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
}

.chip {
  min-height: 56rpx;
  padding: $spacing-xs $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-pill;
  display: flex;
  align-items: center;
  justify-content: center;

  &--selected {
    border-color: $color-primary;
    background-color: $color-primary-light;
  }

  &--hover {
    opacity: 0.85;
  }
}

.chip__text {
  font-size: $font-size-body;
  color: $color-text-1;
}

.textarea {
  width: 100%;
  min-height: 200rpx;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
  box-sizing: border-box;

  &__placeholder {
    color: $color-text-3;
  }
}

.feedback-note {
  display: block;
  text-align: center;
  font-size: $font-size-aux;
  color: $color-text-3;
}
</style>
