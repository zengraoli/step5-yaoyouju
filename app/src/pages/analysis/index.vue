<script setup lang="ts">
/**
 * 一页分析（任务状态查看）
 *
 * 说明：本文件是 T19 期间的最小可用版本——只负责任务状态轮询与结果概览，
 *      完整的 A07「一页理性分析」与 A08「原文对照」界面在 T20 按设计稿实现。
 *
 * 数据来自 server 接口：GET /analyses/task/{taskId}
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import { getAnalysisTask, type AnalysisTaskView } from '../../api/analyses'
import { getStatusBarHeight } from '../../utils/system'

const POLL_INTERVAL = 2000

/** 一页分析详情（完整界面在 T20 实现，这里只读段落数量） */
interface AnalysisLite {
  version: number
  sections: Record<string, unknown[]>
}

const statusBarHeight = ref(0)
const taskId = ref('')
const task = ref<AnalysisTaskView | null>(null)
const errorText = ref('')
let timer: ReturnType<typeof setInterval> | undefined

/** 完成时的一页分析（段落数量预览） */
const analysis = computed<AnalysisLite | null>(() => {
  const raw = task.value?.analysis
  if (!raw || typeof raw !== 'object') return null
  return raw as AnalysisLite
})
onMounted(() => {
  statusBarHeight.value = getStatusBarHeight()
  const pages = getCurrentPages()
  const current = pages[pages.length - 1] as unknown as { options?: { task_id?: string } }
  taskId.value = current?.options?.task_id ?? ''
  if (taskId.value) {
    void poll()
    timer = setInterval(() => void poll(), POLL_INTERVAL)
  } else {
    errorText.value = '缺少任务 ID，请从核对信息页重新生成'
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function poll() {
  if (!taskId.value) return
  try {
    task.value = await getAnalysisTask(taskId.value)
    errorText.value = ''
    if (task.value.status !== 'queued') {
      if (timer) clearInterval(timer)
      timer = undefined
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '查询任务失败'
  }
}

function onBack() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page analysis-page">
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">一页分析</text>
      </view>
    </view>

    <view class="analysis-body">
      <AppNotice v-if="task && (task.status === 'queued')" type="info">
        分析任务正在生成中（排队中），完成后会自动展示。
      </AppNotice>
      <AppNotice v-else-if="task && task.status === 'failed'" type="warn">
        分析暂不可用：已保留你录入的信息与已审核资料，可稍后重试或查看复诊摘要。
      </AppNotice>
      <AppNotice v-else-if="errorText" type="warn">{{ errorText }}</AppNotice>

      <view v-if="task && task.status === 'completed' && analysis" class="summary">
        <text class="summary__title">已生成一页分析（系统生成 v{{ analysis.version }}）</text>
        <view class="summary__sections">
          <view v-for="key in ['known', 'explain', 'unknown', 'next', 'videos']" :key="key" class="summary__row">
            <text class="summary__row-label">{{ key }}</text>
            <text class="summary__row-count">{{ analysis.sections?.[key]?.length ?? 0 }} 条</text>
          </view>
        </view>
        <text class="summary__note">完整的一页理性分析与原文对照界面即将提供。</text>
      </view>
      <AppButton v-if="task && task.status === 'failed'" type="secondary" block @click="poll">重试查询</AppButton>
    </view>
  </view>
</template>

<style lang="scss">
.analysis-page {
  min-height: 100vh;
  background-color: $color-bg;
}

.analysis-body {
  padding: $spacing-lg $spacing-page;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

.summary {
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
}

.summary__title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.summary__sections {
  margin-top: $spacing-md;
}

.summary__row {
  display: flex;
  justify-content: space-between;
  padding: $spacing-sm 0;
  border-top: 2rpx solid $color-border;
}

.summary__row-label {
  font-size: $font-size-body;
  color: $color-text-2;
}

.summary__row-count {
  font-size: $font-size-body;
  color: $color-text-1;
}

.summary__note {
  display: block;
  margin-top: $spacing-md;
  font-size: $font-size-aux;
  color: $color-text-3;
}
</style>
