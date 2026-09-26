<script setup lang="ts">
/**
 * A10 病程时间线（设计稿 docs/design/app/A10.png，设计宽度 375，主 Tab）
 *
 * 按事件记录；区分自述 / 报告原文 / 医生记录；用户可纠正、删除；
 * 变化图不暗示影像恶化。
 *
 * 数据全部来自 server 接口：
 * - GET /episodes              病程列表（本次发作）
 * - GET /episodes/{id}/timeline 按日期分组的事件时间线
 * - GET /episodes/{id}/today   今天是否已记录
 */
import { computed, onMounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { useAuthStore } from '../../stores/auth'
import {
  getEpisode,
  getEpisodeTimeline,
  listEpisodes,
  type CareEventView,
  type EpisodeDetail,
} from '../../api/episodes'
import { getLatestFollowup } from '../../api/followup'
import { beijingDate, getStatusBarHeight, relativeDayLabel } from '../../utils/system'

/** 事件类型 → 展示标签（与设计稿一致） */
const EVENT_LABELS: Record<string, string> = {
  症状: '症状记录',
  报告: '检查报告',
  医嘱: '医生建议',
  行动: '行动记录',
  结局: '结局',
}

/** 图表天数（设计稿：最近 14 天） */
const CHART_DAYS = 14

const auth = useAuthStore()
const statusBarHeight = ref(0)

const loading = ref(true)
const episode = ref<EpisodeDetail | null>(null)
const groups = ref<{ date: string; events: CareEventView[] }[]>([])
const followupQuestionCount = ref(0)

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
    const list = await listEpisodes()
    const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
    if (!active) {
      episode.value = null
      groups.value = []
      return
    }
    episode.value = await getEpisode(active.id)
    const timeline = await loadTimeline(active.id)
    groups.value = timeline
    await loadFollowupCount(active.id)
  } catch {
    groups.value = []
  } finally {
    loading.value = false
  }
}

/** 时间线（服务端已按北京日期分组，保留来源与核实状态） */
async function loadTimeline(episodeId: string): Promise<{ date: string; events: CareEventView[] }[]> {
  return getEpisodeTimeline(episodeId)
}

async function loadFollowupCount(episodeId: string) {
  try {
    // 尚未生成过摘要时接口返回 null（不是错误），不计问题数
    const summary = await getLatestFollowup(episodeId)
    const section = summary?.content.sections.find((s) => s.key === 'questions')
    followupQuestionCount.value = section ? section.items.length : 0
  } catch {
    followupQuestionCount.value = 0
  }
}

/* ---------- 派生数据 ---------- */

/** 全部事件（扁平） */
const allEvents = computed<CareEventView[]>(() => groups.value.flatMap((g) => g.events))

const stats = computed(() => {
  const events = allEvents.value
  return {
    records: events.length,
    reports: events.filter((e) => e.report).length,
    analyses: events.filter((e) => e.event_type === '行动' && /【系统生成/.test(e.raw_text ?? '')).length,
    questions: followupQuestionCount.value,
  }
})

/** 起点说明：约 YYYY-MM 中旬（自述，具体日期尚未确认） */
const onsetLabel = computed<string>(() => {
  const onset = episode.value?.onset_date
  if (!onset) return '起点：尚未确认'
  const month = onset.slice(0, 7)
  return `起点：约 ${month.replace('-', '年')}月（自述，具体日期尚未确认）`
})

/** 最近 14 天每天能坐多久（分钟）；无记录的日期为 null（尚未确认） */
const chart = computed<{ date: string; minutes: number | null }[]>(() => {
  const today = beijingDate()
  const days: { date: string; minutes: number | null }[] = []
  for (let i = CHART_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(`${today}T00:00:00.000+08:00`)
    d.setDate(d.getDate() - i)
    // 按北京时间取日期（occurred_at 存 UTC，需 +8 小时后再截取）
    const date = new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const log = allEvents.value.find(
      (e) => e.symptom_log && beijingDate(e.occurred_at) === date,
    )
    days.push({ date, minutes: log?.symptom_log?.sit_minutes ?? null })
  }
  return days
})

const chartMax = computed<number>(() => {
  const values = chart.value.map((c) => c.minutes ?? 0)
  return Math.max(30, ...values)
})

function barHeight(minutes: number | null): string {
  if (minutes === null) return '8%'
  const ratio = minutes / chartMax.value
  return `${Math.max(8, Math.round(ratio * 100))}%`
}

/** 事件的状态标签（核实状态 + 来源） */
function eventTags(ev: CareEventView): { key: 'confirmed' | 'unconfirmed' | 'unverified' | 'quote' | 'self'; text: string }[] {
  const tags: { key: 'confirmed' | 'unconfirmed' | 'unverified' | 'quote' | 'self'; text: string }[] = []
  if (ev.source_type === '报告原文') tags.push({ key: 'quote', text: '报告原文' })
  else if (ev.source_type === '医生记录') tags.push({ key: 'self', text: '医生记录' })
  else tags.push({ key: 'self', text: ev.verify_status === '尚未确认' ? '自述转述' : '自述' })
  if (ev.verify_status === '已确认') tags.push({ key: 'confirmed', text: '已确认' })
  else if (ev.verify_status === '有冲突') tags.push({ key: 'unconfirmed', text: '有冲突' })
  else tags.push({ key: 'unconfirmed', text: '尚未确认' })
  return tags
}

/** 事件标题行右侧的类型标签 */
function eventTypeTag(ev: CareEventView): string {
  if (ev.event_type === '行动' && /【系统生成/.test(ev.raw_text ?? '')) return '一页分析'
  return EVENT_LABELS[ev.event_type] ?? ev.event_type
}

/** 事件摘要文本 */
function eventText(ev: CareEventView): string {
  const text = (ev.raw_text ?? '').replace(/^【系统生成 v\d+】/, '').trim()
  return text || '（无原文）'
}

/** 系统生成版本号（行动事件中的【系统生成 vN】） */
function analysisVersion(ev: CareEventView): string {
  const m = /【系统生成 v(\d+)】/.exec(ev.raw_text ?? '')
  return m ? `v${m[1]}` : ''
}

function onFilter() {
  uni.showToast({ title: '筛选功能将在后续版本提供', icon: 'none' })
}

function onAdd() {
  uni.navigateTo({ url: '/pages/change/confirm' })
}

function onRecordToday() {
  uni.navigateTo({ url: '/pages/timeline/record' })
}

</script>

<template>
  <view class="page timeline-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <text class="nav__title">病程</text>
        <view class="nav__actions">
          <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80" @click="onFilter">
            <AppIcon name="filter" :size="22" />
          </view>
          <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80" @click="onAdd">
            <AppIcon name="close" :size="22" />
          </view>
        </view>
      </view>
    </view>

    <view v-if="!auth.isLoggedIn" class="timeline-body">
      <AppNotice type="info">登录后可以查看和管理你的病程记录。</AppNotice>
    </view>

    <view v-else-if="episode" class="timeline-body">
      <!-- 本次发作 -->
      <AppCard>
        <view class="episode-head">
          <text class="episode-head__title">本次发作</text>
          <StatusTag status="confirmed" text="保守治疗中" />
        </view>
        <text class="episode-head__onset">{{ onsetLabel }}</text>
        <view class="stats">
          <view class="stats__item">
            <text class="stats__num">{{ stats.records }}</text>
            <text class="stats__label">条记录</text>
          </view>
          <view class="stats__item">
            <text class="stats__num">{{ stats.reports }}</text>
            <text class="stats__label">份报告</text>
          </view>
          <view class="stats__item">
            <text class="stats__num">{{ stats.analyses }}</text>
            <text class="stats__label">次分析</text>
          </view>
          <view class="stats__item">
            <text class="stats__num">{{ stats.questions }}</text>
            <text class="stats__label">个复诊问题</text>
          </view>
        </view>
      </AppCard>

      <!-- 最近 14 天 · 每天能坐多久 -->
      <AppCard>
        <view class="chart-head">
          <text class="chart-head__title">最近 14 天 · 每天能坐多久</text>
          <text class="chart-head__unit">分钟</text>
        </view>
        <view class="chart">
          <view v-for="(bar, i) in chart" :key="i" class="chart__col">
            <view class="chart__track">
              <view
                class="chart__bar"
                :class="{ 'chart__bar--unconfirmed': bar.minutes === null }"
                :style="{ height: barHeight(bar.minutes) }"
              />
            </view>
            <text class="chart__date">{{ bar.date.slice(5).replace('-', '/') }}</text>
          </view>
        </view>
        <text class="chart-note">图中变化只反映你的记录，不代表影像变化或病情恶化。</text>
      </AppCard>

      <!-- 记录今天入口 -->
      <view class="record-entry" hover-class="record-entry--hover" :hover-stay-time="80" @click="onRecordToday">
        <AppIcon name="edit" :size="18" />
        <text class="record-entry__text">记录今天（约 1 分钟，每个问题都可以跳过）</text>
        <AppIcon name="arrow-right" :size="16" />
      </view>

      <!-- 记录（按事件，保留来源与核实状态） -->
      <AppCard>
        <text class="records-title">记录（按事件，保留来源与核实状态）</text>
        <view class="timeline">
          <view v-for="group in groups" :key="group.date" class="timeline__group">
            <view class="timeline__date">
              <view class="timeline__dot" />
              <text class="timeline__date-text">
                {{ relativeDayLabel(group.date) }} · {{ group.date === beijingDate() ? '今天' : group.date }}
              </text>
            </view>
            <view v-for="ev in group.events" :key="ev.id" class="timeline__event">
              <view class="timeline__event-head">
                <text class="timeline__event-type">{{ eventTypeTag(ev) }}</text>
                <text v-if="analysisVersion(ev)" class="timeline__event-version">{{ analysisVersion(ev) }}</text>
                <view class="timeline__event-more" hover-class="timeline__event-more--hover" :hover-stay-time="80">
                  <AppIcon name="ellipsis" :size="18" />
                </view>
              </view>
              <text class="timeline__event-text">{{ eventText(ev) }}</text>
              <view class="timeline__event-tags">
                <StatusTag v-for="(tag, i) in eventTags(ev)" :key="i" :status="tag.key" :text="tag.text" />
              </view>
            </view>
          </view>
        </view>
      </AppCard>
    </view>

    <view v-else-if="!loading" class="timeline-body">
      <AppCard>
        <text class="empty-title">还没有病程记录</text>
        <text class="empty-desc">从当前关键变化确认开始，系统会按事件整理你的病程，保留来源与核实状态。</text>
        <view class="empty-actions">
          <AppButton type="primary" @click="onAdd">开始关键变化确认</AppButton>
        </view>
      </AppCard>
    </view>

    <TabBar />
  </view>
</template>

<style lang="scss">
.timeline-page {
  min-height: 100vh;
  background-color: $color-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 120rpx);
}

.timeline-body {
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 本次发作 ---------- */
.episode-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.episode-head__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.episode-head__onset {
  display: block;
  margin-top: $spacing-sm;
  font-size: $font-size-aux;
  color: $color-text-2;
}

.stats {
  display: flex;
  margin-top: $spacing-lg;
}

.stats__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $spacing-sm 0;
  background-color: $color-bg;
  border-radius: $radius-button;
  margin-right: $spacing-sm;

  &:last-child {
    margin-right: 0;
  }
}

.stats__num {
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-primary;
}

.stats__label {
  margin-top: $spacing-xs;
  font-size: $font-size-tag;
  color: $color-text-2;
}

/* ---------- 图表 ---------- */
.chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.chart-head__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.chart-head__unit {
  font-size: $font-size-aux;
  color: $color-text-3;
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: $spacing-xs;
  height: 200rpx;
  margin-top: $spacing-lg;
}

.chart__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.chart__track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.chart__bar {
  width: 70%;
  min-height: 12rpx;
  background-color: $color-primary;
  border-radius: $radius-tag $radius-tag 0 0;

  &--unconfirmed {
    background-color: $color-warn;
  }
}

.chart__date {
  margin-top: $spacing-xs;
  font-size: 18rpx;
  color: $color-text-3;
  transform: scale(0.85);
}

.chart-note {
  display: block;
  margin-top: $spacing-md;
  font-size: $font-size-aux;
  color: $color-text-2;
}

/* ---------- 记录今天入口 ---------- */
.record-entry {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  min-height: 88rpx;
  padding: 0 $spacing-lg;
  background-color: $color-primary-light;
  border: 2rpx solid $color-primary;
  border-radius: $radius-card;
  color: $color-primary;

  &--hover {
    opacity: 0.85;
  }
}

.record-entry__text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-primary;
}

/* ---------- 时间线 ---------- */
.records-title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  margin-bottom: $spacing-md;
}

.timeline__group {
  margin-bottom: $spacing-lg;

  &:last-child {
    margin-bottom: 0;
  }
}

.timeline__date {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-bottom: $spacing-sm;
}

.timeline__dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background-color: $color-primary;
  flex-shrink: 0;
}

.timeline__date-text {
  font-size: $font-size-aux;
  color: $color-text-2;
}

.timeline__event {
  margin-left: $spacing-xs;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  margin-bottom: $spacing-sm;
}

.timeline__event-head {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.timeline__event-type {
  font-size: $font-size-aux;
  color: $color-info;
  font-weight: $font-weight-medium;
}

.timeline__event-version {
  font-size: $font-size-tag;
  color: $color-text-2;
}

.timeline__event-more {
  margin-left: auto;
  color: $color-text-3;

  &--hover {
    opacity: 0.7;
  }
}

.timeline__event-text {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.timeline__event-tags {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-xs;
  margin-top: $spacing-sm;
}

/* ---------- 空状态 ---------- */
.empty-title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.empty-desc {
  display: block;
  margin-top: $spacing-sm;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
}

.empty-actions {
  margin-top: $spacing-lg;
}
</style>
