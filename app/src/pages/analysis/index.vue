<script setup lang="ts">
/**
 * A07 一页理性分析（设计稿 docs/design/app/A07.png，设计宽度 375）
 *
 * 固定五段结构：① 当前确认的信息与来源 ② 这些信息能支持什么解释
 * ③ 仍缺哪些信息、哪些不能据此判断 ④ 建议向医生确认的问题与下一步 ⑤ 可选科普视频
 *
 * 产品红线：
 * - 每条解释都带来源（引用证据文档）；系统生成内容带版本号，不标为事实来源；
 * - 缺失即未知、不补写概率；「尚未确认」不会被当作「没有」；
 * - 顶部常驻「不作诊断」；页脚说明本页边界。
 *
 * 数据全部来自 server 接口：
 * - GET  /analyses/task/{taskId}  任务状态（排队中 / 完成 / 失败回退）
 * - GET  /analyses/{id}           一页分析详情
 * - POST /episodes/{id}/events    保存到病程（行动事件，明确标注系统生成版本）
 * - POST /feedback                帮助类型反馈（不自动进入训练或内容库）
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import {
  getAnalysisTask,
  type AnalysisView,
  type AnalysisTaskView,
} from '../../api/analyses'
import { addCareEvent } from '../../api/episodes'
import type { HelpType } from '../../api/feedback'
import { submitHelpFeedback } from '../../api/feedback'
import { beijingDate, getStatusBarHeight } from '../../utils/system'

/** 本地存储键：A07 勾选的复诊问题（供复诊摘要使用） */
const QUESTIONS_STORAGE_KEY = 'yyj_followup_questions'

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 2000

/** 帮助类型反馈（服务端枚举：看懂了 / 知道下一步 / 都不好） */
const HELP_TYPES: { label: string; value: HelpType }[] = [
  { label: '看懂了', value: '看懂了' },
  { label: '知道下一步', value: '知道下一步' },
  { label: '都不好，问题没解决', value: '都不好' },
]

const statusBarHeight = ref(0)
const taskId = ref('')
const task = ref<AnalysisTaskView | null>(null)
const analysis = ref<AnalysisView | null>(null)
const errorText = ref('')
const saving = ref(false)
const feedbackDone = ref('')
/** 勾选的复诊问题下标 */
const checkedQuestions = ref<number[]>([])
let timer: ReturnType<typeof setInterval> | undefined

/** 分析 ID（从首页「查看一页分析」进入时传入） */
const analysisId = ref('')

onLoad((options) => {
  taskId.value = typeof options?.task_id === 'string' ? options.task_id : ''
  analysisId.value = typeof options?.id === 'string' ? options.id : ''
})

onMounted(() => {
  statusBarHeight.value = getStatusBarHeight()
  if (taskId.value) {
    void poll()
    timer = setInterval(() => void poll(), POLL_INTERVAL)
  } else if (analysisId.value) {
    // 直接查看已有的一页分析（GET /analyses/{id}）
    void loadExisting()
  } else {
    errorText.value = '缺少分析任务信息，请从核对信息页重新生成'
  }
})

/** 载入已有分析（首页入口） */
async function loadExisting() {
  try {
    const { getAnalysis } = await import('../../api/analyses')
    const detail = await getAnalysis(analysisId.value)
    analysis.value = detail
    task.value = { status: 'completed', task_id: '', analysis: detail }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '分析加载失败'
  }
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

async function poll() {
  if (!taskId.value) return
  try {
    task.value = await getAnalysisTask(taskId.value)
    errorText.value = ''
    if (task.value.status === 'completed' && task.value.analysis) {
      analysis.value = task.value.analysis
      stopPolling()
    } else if (task.value.status === 'failed') {
      stopPolling()
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '查询分析状态失败'
  }
}

function stopPolling() {
  if (timer) clearInterval(timer)
  timer = undefined
}

/** 跳转 A18 服务不可用回退页（任务 id 一并传入） */
function onOpenFallback() {
  const id = task.value?.task_id ?? taskId.value
  const target = '/pages/analysis/fallback?task_id=' + encodeURIComponent(id)
  uni.navigateTo({ url: target })
}

/** 重试：重新提交一次分析（当前 episode） */
async function onRetry() {
  if (!analysis.value && task.value?.status === 'failed') {
    // 失败后重新生成：回到核对信息页走完整流程（安全规则重新校验）
    uni.navigateBack({
      fail: () => uni.reLaunch({ url: '/pages/index/index' }),
    })
  }
}

/* ---------- 派生数据 ---------- */

const meta = computed(() => analysis.value?.sections.meta ?? null)
const known = computed(() => analysis.value?.sections.known ?? [])
const explains = computed(() => analysis.value?.sections.explain ?? [])
const unknowns = computed(() => analysis.value?.sections.unknown ?? [])
const nextItems = computed(() => analysis.value?.sections.next ?? [])
const videos = computed(() => analysis.value?.sections.videos ?? [])

/** 基于最新信息的时间（界面按北京时间显示） */
const basedOnDate = computed(() =>
  meta.value?.generated_at ? beijingDate(meta.value.generated_at) : '',
)

/** 模型版本（如「本地模拟模型 prompt-v1」） */
const modelLabel = computed(() => meta.value?.model_release ?? '')

/** 引导段：由已知与未知信息组合（数据驱动，不写死） */
const intro = computed<string>(() => {
  const parts: string[] = []
  const reportKnown = known.value.find((k) => k.source === '报告原文')
  if (reportKnown) parts.push(`你上传的报告中提到了：${reportKnown.text}`)
  const selfKnown = known.value.find((k) => k.source === '自述')
  if (selfKnown) parts.push(`你描述：${selfKnown.text}`)
  if (unknowns.value.length > 0) {
    parts.push(`还有 ${unknowns.value.length} 项信息尚未确认，下面会先解释报告术语，再整理复诊时需要确认的问题。`)
  }
  return parts.join('；')
})

/** 已知条目的来源标签：报告原文可回看；自述按核实状态显示 */
function knownTag(item: { source: string; text: string }): { key: 'quote' | 'self' | 'unverified'; text: string } {
  if (item.source === '报告原文') return { key: 'quote', text: '报告原文 · 可回看' }
  if (item.source === '医生记录') return { key: 'self', text: '医生记录' }
  if (/尚未确认/.test(item.text)) return { key: 'unverified', text: '自述 · 未经核实' }
  return { key: 'self', text: '自述' }
}

/** 解释编号（②-1、②-2 …）用于原文对照跳转 */
function explainIndex(i: number): string {
  return `②-${i + 1}`
}

/** 跳转原文对照（按解释查看） */
function onOpenReport(index: number) {
  if (!analysis.value) return
  const query = `analysis_id=${encodeURIComponent(analysis.value.id)}&index=${index}`
  uni.navigateTo({ url: `/pages/analysis/report?${query}` })
}

/* ---------- 复诊问题清单 ---------- */

function onToggleQuestion(index: number) {
  checkedQuestions.value = checkedQuestions.value.includes(index)
    ? checkedQuestions.value.filter((i) => i !== index)
    : [...checkedQuestions.value, index]
}

function onAddQuestions() {
  const items = nextItems.value
  const selected = checkedQuestions.value.map((i) => items[i]).filter(Boolean)
  uni.setStorageSync(QUESTIONS_STORAGE_KEY, selected.map((s) => s.text))
  toast(`已加入复诊问题清单（已选 ${selected.length} 条）`)
}

/* ---------- 保存到病程 / 生成复诊摘要 ---------- */

/** 保存到病程：写入行动事件，原文明确标注「系统生成 + 版本号」，不标为事实来源 */
async function onSaveToEpisode() {
  if (!analysis.value || saving.value) return
  saving.value = true
  try {
    const version = analysis.value.version
    const summary = known.value
      .slice(0, 2)
      .map((k) => k.text)
      .join('；')
    await addCareEvent(analysis.value.episode_id, {
      event_type: '行动',
      source_type: '自述',
      raw_text: `【系统生成 v${version}】保存了一页分析：${summary || '（无已知信息）'}`,
      verify_status: '尚未确认',
      occurred_at: new Date().toISOString(),
    })
    toast('已保存到病程（标注为系统生成）')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

function onGenerateFollowup() {
  if (!analysis.value) return
  uni.navigateTo({
    url: `/pages/followup/index?episode_id=${encodeURIComponent(analysis.value.episode_id)}`,
  })
}

/* ---------- 反馈（不自动进入训练或内容库） ---------- */

async function onHelpFeedback(value: HelpType) {
  if (!analysis.value || feedbackDone.value) return
  try {
    await submitHelpFeedback({ analysis_id: analysis.value.id, help_type: value })
    feedbackDone.value = value
    toast('已收到你的反馈（不会自动进入训练或内容库）')
  } catch (e) {
    toast(e instanceof Error ? e.message : '反馈提交失败，请稍后重试')
  }
}

function onReportError() {
  if (!analysis.value) return
  uni.navigateTo({
    url: `/pages/feedback/index?analysis_id=${encodeURIComponent(analysis.value.id)}`,
  })
}

function onBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/index/index' }),
  })
}
</script>

<template>
  <view class="page analysis-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">一页分析</text>
        <view class="nav__actions">
          <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80">
            <AppIcon name="upload" :size="22" />
          </view>
          <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80">
            <AppIcon name="ellipsis" :size="22" />
          </view>
        </view>
      </view>
    </view>

    <!-- 排队中 -->
    <view v-if="task && task.status === 'queued'" class="analysis-body">
      <AppNotice type="info">
        分析任务排队中（尝试 {{ task.attempts ?? 0 }} 次），完成后会自动展示。你不会被反复扣费或无限重试。
      </AppNotice>
      <view class="skeleton-card">
        <view class="skeleton skeleton--title" />
        <view class="skeleton skeleton--line" />
        <view class="skeleton skeleton--line" />
        <view class="skeleton skeleton--line skeleton--short" />
      </view>
    </view>

    <!-- 失败回退 -->
    <view v-else-if="task && task.status === 'failed'" class="analysis-body">
      <AppNotice type="warn">
        分析服务暂时不可用（{{ task.reason ?? '未知原因' }}）。你录入的信息与已审核资料仍然保留，可稍后重试；复诊摘要功能不受影响。
      </AppNotice>
      <AppCard>
        <text class="fallback__title">已保留的内容</text>
        <view class="fallback__rows">
          <view v-for="(item, i) in (task.fallback?.known ?? []).slice(0, 5)" :key="i" class="fallback__row">
            <text class="fallback__row-text">{{ item.text }}</text>
            <StatusTag status="unverified" text="尚未确认" />
          </view>
        </view>
        <text class="fallback__note">{{ task.fallback?.meta?.disclaimer ?? '' }}</text>
      </AppCard>
      <AppButton type="secondary" block @click="onRetry">重新生成</AppButton>
      <AppButton type="primary" block @click="onGenerateFollowup">仍去准备复诊摘要</AppButton>
      <view
        class="fallback-link"
        hover-class="fallback-link--hover"
        :hover-stay-time="80"
        @click="onOpenFallback"
      >
        <text class="fallback-link__text">查看服务说明与仍然可用的功能</text>
      </view>
    </view>

    <!-- 网络 / 查询错误 -->
    <view v-else-if="errorText && !task" class="analysis-body">
      <AppNotice type="warn">{{ errorText }}</AppNotice>
      <AppButton type="secondary" block @click="poll">重试查询</AppButton>
    </view>

    <!-- 一页分析 -->
    <view v-else-if="analysis" class="analysis-body">
      <!-- 头部：不作诊断 + 版本 + 模型 -->
      <view class="head-card">
        <view class="head-card__top">
          <StatusTag status="no-diagnosis" text="不作诊断" />
          <text class="head-card__based">基于 {{ basedOnDate }} 的信息</text>
        </view>
        <text class="head-card__version">分析版本 v{{ analysis.version }} · 模型 {{ modelLabel }}</text>
        <text v-if="intro" class="head-card__intro">{{ intro }}</text>
      </view>

      <!-- ① 当前确认的信息与来源 -->
      <AppCard>
        <view class="sec-head">
          <view class="sec-head__badge"><text class="sec-head__badge-text">1</text></view>
          <text class="sec-head__title">当前确认的信息与来源</text>
        </view>
        <view class="known-list">
          <view v-for="(item, i) in known" :key="i" class="known-item">
            <view class="known-item__dot" />
            <view class="known-item__body">
              <text class="known-item__text">{{ item.text }}</text>
              <view class="known-item__tags">
                <StatusTag :status="knownTag(item).key" :text="knownTag(item).text" />
              </view>
            </view>
          </view>
        </view>
      </AppCard>

      <!-- ② 这些信息能支持什么解释 -->
      <AppCard>
        <view class="sec-head">
          <view class="sec-head__badge"><text class="sec-head__badge-text">2</text></view>
          <text class="sec-head__title">这些信息能支持什么解释</text>
        </view>
        <view
          v-for="(item, i) in explains"
          :key="i"
          class="explain-item"
          hover-class="explain-item--hover"
          :hover-stay-time="80"
          @click="onOpenReport(i)"
        >
          <view class="explain-item__head">
            <text class="explain-item__index">解释 {{ explainIndex(i) }}</text>
            <AppIcon name="arrow-right" :size="16" />
          </view>
          <text class="explain-item__text">{{ item.text }}</text>
          <view class="explain-item__cites">
            <text v-for="(c, j) in item.citations" :key="j" class="explain-item__cite">
              来源：{{ c.doc_title }}
            </text>
          </view>
        </view>
      </AppCard>

      <!-- ③ 仍缺哪些信息、哪些不能据此判断 -->
      <AppCard>
        <view class="sec-head">
          <view class="sec-head__badge sec-head__badge--warn"><text class="sec-head__badge-text">3</text></view>
          <text class="sec-head__title">仍缺哪些信息、哪些不能据此判断</text>
        </view>
        <view class="unknown-list">
          <view v-for="(item, i) in unknowns" :key="i" class="unknown-item">
            <view class="unknown-item__dot" />
            <text class="unknown-item__text">{{ item }}</text>
          </view>
        </view>
      </AppCard>

      <!-- ④ 建议向医生确认的问题与下一步 -->
      <AppCard>
        <view class="sec-head">
          <view class="sec-head__badge sec-head__badge--ok"><text class="sec-head__badge-text">4</text></view>
          <text class="sec-head__title">建议向医生确认的问题与下一步</text>
        </view>
        <view class="question-list">
          <view
            v-for="(item, i) in nextItems"
            :key="i"
            class="question-item"
            hover-class="question-item--hover"
            :hover-stay-time="80"
            @click="onToggleQuestion(i)"
          >
            <view class="question-item__box" :class="{ 'question-item__box--checked': checkedQuestions.includes(i) }">
              <AppIcon v-if="checkedQuestions.includes(i)" name="check" :size="13" />
            </view>
            <text class="question-item__text">{{ item.text }}</text>
            <StatusTag v-if="item.type === '复诊问题'" status="unconfirmed" text="复诊问题" />
          </view>
        </view>
        <view class="question-add" hover-class="question-add--hover" :hover-stay-time="80" @click="onAddQuestions">
          <text class="question-add__text">加入复诊问题清单（已选 {{ checkedQuestions.length }} 条）</text>
        </view>
      </AppCard>

      <!-- ⑤ 可选科普视频与本次记录有关 -->
      <AppCard>
        <view class="sec-head">
          <view class="sec-head__badge sec-head__badge--info"><text class="sec-head__badge-text">5</text></view>
          <text class="sec-head__title">可选科普视频与本次记录有关</text>
        </view>
        <view v-for="(item, i) in videos" :key="i" class="video-card">
          <view class="video-card__play">
            <AppIcon name="play" :size="20" />
          </view>
          <view class="video-card__body">
            <text class="video-card__title">{{ item.title }}</text>
            <view class="video-card__meta">
              <StatusTag status="reviewed" text="已审核 v2" />
              <text class="video-card__reason">推荐理由：{{ item.reason }}</text>
            </view>
          </view>
        </view>
        <view v-if="videos.length === 0" class="empty-hint">
          <text class="empty-hint__text">本次没有推荐的科普视频（可在内容库中浏览已审核内容）。</text>
        </view>
      </AppCard>

      <!-- 操作：保存到病程 / 生成复诊摘要 -->
      <view class="actions-row">
        <AppButton type="secondary" :loading="saving" @click="onSaveToEpisode">保存到病程</AppButton>
        <AppButton type="primary" @click="onGenerateFollowup">生成复诊摘要</AppButton>
      </view>

      <!-- 反馈卡片 -->
      <AppCard>
        <text class="feedback__title">这次分析对你有帮助吗？</text>
        <view class="feedback__chips">
          <view
            v-for="help in HELP_TYPES"
            :key="help.value"
            class="feedback__chip"
            :class="{ 'feedback__chip--selected': feedbackDone === help.value }"
            hover-class="feedback__chip--hover"
            :hover-stay-time="80"
            @click="onHelpFeedback(help.value)"
          >
            <text class="feedback__chip-text">{{ help.label }}</text>
          </view>
        </view>
        <view class="feedback__report" hover-class="feedback__report--hover" :hover-stay-time="80" @click="onReportError">
          <AppIcon name="alert" :size="16" />
          <text class="feedback__report-text">报告错误（会记录分析版本与影响范围）</text>
        </view>
      </AppCard>

      <!-- 页脚说明 -->
      <AppNotice type="info">
        本页说明“已经知道什么、仍不知道什么、接下来怎么办”，帮助你理解和复诊，不代替医生诊断。
      </AppNotice>
    </view>

    <TabBar />
  </view>
</template>

<style lang="scss">
.analysis-page {
  min-height: 100vh;
  background-color: $color-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 120rpx);
}

.analysis-body {
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 头部卡片 ---------- */
.head-card {
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
}

.head-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-card__based {
  font-size: $font-size-aux;
  color: $color-text-2;
}

.head-card__version {
  display: block;
  margin-top: $spacing-sm;
  font-size: $font-size-aux;
  color: $color-text-3;
}

.head-card__intro {
  display: block;
  margin-top: $spacing-md;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- 段落头部 ---------- */
.sec-head {
  display: flex;
  align-items: center;
  margin-bottom: $spacing-md;
}

.sec-head__badge {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background-color: $color-primary;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: $spacing-sm;
  flex-shrink: 0;

  &--warn {
    background-color: $color-warn;
  }

  &--ok {
    background-color: $color-ok;
  }

  &--info {
    background-color: $color-info;
  }
}

.sec-head__badge-text {
  font-size: $font-size-tag;
  color: $color-surface;
  font-weight: $font-weight-medium;
}

.sec-head__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

/* ---------- ① 已知 ---------- */
.known-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
}

.known-item {
  display: flex;
  align-items: flex-start;
}

.known-item__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background-color: $color-primary;
  margin-top: 12rpx;
  margin-right: $spacing-sm;
  flex-shrink: 0;
}

.known-item__body {
  flex: 1;
  min-width: 0;
}

.known-item__text {
  display: block;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.known-item__tags {
  display: flex;
  gap: $spacing-xs;
  margin-top: $spacing-xs;
}

/* ---------- ② 解释 ---------- */
.explain-item {
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  margin-bottom: $spacing-md;

  &:last-child {
    margin-bottom: 0;
  }

  &--hover {
    background-color: $color-primary-light;
  }
}

.explain-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: $color-primary;
}

.explain-item__index {
  font-size: $font-size-aux;
  color: $color-primary;
  font-weight: $font-weight-medium;
}

.explain-item__text {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.explain-item__cites {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-md;
  margin-top: $spacing-sm;
}

.explain-item__cite {
  font-size: $font-size-aux;
  color: $color-info;
}

/* ---------- ③ 未知 ---------- */
.unknown-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.unknown-item {
  display: flex;
  align-items: flex-start;
}

.unknown-item__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background-color: $color-warn;
  margin-top: 12rpx;
  margin-right: $spacing-sm;
  flex-shrink: 0;
}

.unknown-item__text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- ④ 复诊问题 ---------- */
.question-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.question-item {
  display: flex;
  align-items: flex-start;
  padding: $spacing-sm 0;

  &--hover {
    opacity: 0.85;
  }
}

.question-item__box {
  width: 36rpx;
  height: 36rpx;
  border: 2rpx solid $color-border;
  border-radius: $radius-tag;
  margin-top: 6rpx;
  margin-right: $spacing-sm;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-surface;
  flex-shrink: 0;

  &--checked {
    background-color: $color-primary;
    border-color: $color-primary;
  }
}

.question-item__text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.question-add {
  margin-top: $spacing-md;
  min-height: 72rpx;
  border: 2rpx dashed $color-primary;
  border-radius: $radius-button;
  display: flex;
  align-items: center;
  justify-content: center;

  &--hover {
    background-color: $color-primary-light;
  }
}

.question-add__text {
  font-size: $font-size-body;
  color: $color-primary;
}

/* ---------- ⑤ 视频 ---------- */
.video-card {
  display: flex;
  align-items: center;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
}

.video-card__play {
  width: 72rpx;
  height: 72rpx;
  border-radius: $radius-button;
  background-color: $color-primary-light;
  color: $color-primary;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.video-card__body {
  flex: 1;
  margin-left: $spacing-md;
  min-width: 0;
}

.video-card__title {
  display: block;
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: $line-height-body;
}

.video-card__meta {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-top: $spacing-xs;
}

.video-card__reason {
  font-size: $font-size-aux;
  color: $color-text-2;
}

.empty-hint {
  padding: $spacing-sm 0;
}

.empty-hint__text {
  font-size: $font-size-body;
  color: $color-text-3;
}

/* ---------- 操作 ---------- */
.actions-row {
  display: flex;
  gap: $spacing-md;

  > view {
    flex: 1;
  }
}

/* ---------- 反馈 ---------- */
.feedback__title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.feedback__chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

.feedback__chip {
  min-height: 64rpx;
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

.feedback__chip-text {
  font-size: $font-size-body;
  color: $color-text-1;
}

.feedback__report {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  margin-top: $spacing-md;
  color: $color-text-2;

  &--hover {
    opacity: 0.75;
  }
}

.feedback__report-text {
  font-size: $font-size-aux;
  color: $color-text-2;
}

/* ---------- 排队骨架 ---------- */
.skeleton-card {
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
}

.skeleton {
  border-radius: $radius-tag;
  background-color: $color-neutral-light;
  margin-bottom: $spacing-md;

  &--title {
    height: 40rpx;
    width: 60%;
  }

  &--line {
    height: 28rpx;
    width: 100%;
  }

  &--short {
    width: 40%;
  }
}

/* ---------- 失败回退 ---------- */
.fallback__title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.fallback__rows {
  margin-top: $spacing-md;
}

.fallback__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: $spacing-sm;
  padding: $spacing-sm 0;
  border-top: 2rpx solid $color-border;
}

.fallback__row-text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.fallback__note {
  display: block;
  margin-top: $spacing-md;
  font-size: $font-size-aux;
  color: $color-text-2;
}

/* 失败态：跳转服务说明页 */
.fallback-link {
  min-height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fallback-link__text {
  font-size: $font-size-body;
  color: $color-primary;
  text-decoration: underline;
}
</style>

