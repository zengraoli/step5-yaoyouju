<script setup lang="ts">
/**
 * W05 病程与记录（设计稿 docs/design/web/W05.png，设计宽度 1440）
 *
 * 左：14 天记录图（带免责）+ 时间线（按事件，保留来源与核实状态）；
 * 右：「记录今天」常驻表单（允许跳过；缺失不默认阴性；不复用昨日答案）。
 *
 * 数据全部来自 server 接口：
 * - GET  /episodes、GET /episodes/{id}、GET /episodes/{id}/timeline、GET /episodes/{id}/today
 * - POST /episodes/{id}/today-logs   结构化记录
 * - POST /episodes/{id}/events       「与昨天相比 / 今天做了什么」自述事件
 */
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import {
  addCareEvent,
  getEpisode,
  getTodayStatus,
  listEpisodes,
  logToday,
  type CareEventView,
  type EpisodeDetail,
} from '@/api/episodes'
import { beijingDate, relativeDayLabel } from '@/utils/date'

/** 能坐多久（设计稿选项 → 分钟中值，用于趋势图） */
const SIT_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: '<15分钟', minutes: 10 },
  { label: '15-30', minutes: 22 },
  { label: '30-60', minutes: 45 },
  { label: '>60', minutes: 75 },
  { label: '跳过', minutes: null },
]

/** 计划活动完成情况（服务端枚举） */
const ACTIVITY_OPTIONS: { label: string; value: string | null }[] = [
  { label: '能', value: '完成' },
  { label: '部分', value: '部分完成' },
  { label: '不能', value: '未完成' },
  { label: '跳过', value: null },
]

/** 与昨天相比（自述事件保存） */
const CHANGE_OPTIONS = ['加重', '差不多', '减轻', '跳过']

/** 腿部麻木或无力（不沿用昨天答案） */
const LEG_OPTIONS = ['有', '没有', '尚未确认']

/** 今天做了什么（可多选；作为行动事件保存） */
const ACTIVITY_LOG_OPTIONS = ['步行', '热敷', '按医嘱用药', '休息', '康复练习', '久坐工作']

const auth = useAuthStore()

const CHART_DAYS = 14

const loading = ref(true)
const episode = ref<EpisodeDetail | null>(null)
const groups = ref<{ date: string; events: CareEventView[] }[]>([])
const todayLogged = ref(false)

/** 记录今天表单 */
const sitIndex = ref(-1)
const activityIndex = ref(-1)
const changeIndex = ref(-1)
const legIndex = ref(-1)
const activities = ref<string[]>([])
const worry = ref('')
const saving = ref(false)

onMounted(async () => {
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
    const { getEpisodeTimeline } = await import('@/api/episodes')
    groups.value = await getEpisodeTimeline(active.id)
    const today = await getTodayStatus(active.id).catch(() => null)
    todayLogged.value = Boolean(today?.logged)
  } catch {
    groups.value = []
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  alert(title)
}

/* ---------- 派生数据 ---------- */

const allEvents = computed<CareEventView[]>(() => groups.value.flatMap((g) => g.events))

const stats = computed(() => {
  const events = allEvents.value
  return {
    records: events.length,
    reports: events.filter((e) => e.report).length,
    analyses: episode.value?.analysis_count ?? 0,
  }
})

const onsetLabel = computed<string>(() => {
  const onset = episode.value?.onset_date
  if (!onset) return '起点时间尚未确认'
  const certainty = episode.value?.onset_certainty ?? '尚未确认'
  if (certainty === '已确认') return `起点：${onset}（自述，已确认）`
  return `起点约 ${onset.slice(0, 7).replace('-', ' 年 ')} 月（自述，具体日期尚未确认）`
})

/** 最近 14 天每天能坐多久（分钟）；无记录的日期为 null（尚未确认） */
const chart = computed<{ date: string; minutes: number | null }[]>(() => {
  const today = beijingDate()
  const days: { date: string; minutes: number | null }[] = []
  for (let i = CHART_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(`${today}T00:00:00.000+08:00`)
    d.setDate(d.getDate() - i)
    const date = new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
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
  if (minutes === null) return '10%'
  const ratio = minutes / chartMax.value
  return `${Math.max(10, Math.round(ratio * 100))}%`
}

/** 事件类型标签 */
function eventTypeTag(ev: CareEventView): string {
  if (ev.event_type === '行动' && /【系统生成/.test(ev.raw_text ?? '')) return '一页分析'
  const labels: Record<string, string> = { 症状: '症状记录', 报告: '检查报告', 医嘱: '医生建议', 行动: '行动记录', 结局: '结局' }
  return labels[ev.event_type] ?? ev.event_type
}

function eventText(ev: CareEventView): string {
  return (ev.raw_text ?? '').replace(/^【系统生成 v\d+】/, '').trim() || '（无原文）'
}

function eventTags(ev: CareEventView): { key: 'quote' | 'self' | 'confirmed' | 'unconfirmed' | 'unverified'; text: string }[] {
  const tags: { key: 'quote' | 'self' | 'confirmed' | 'unconfirmed' | 'unverified'; text: string }[] = []
  if (ev.source_type === '报告原文') tags.push({ key: 'quote', text: '报告原文' })
  else if (ev.source_type === '医生记录') tags.push({ key: 'self', text: '医生记录' })
  else tags.push({ key: 'self', text: '自述' })
  if (ev.event_type === '报告') tags.push({ key: 'confirmed', text: '已录入' })
  if (ev.verify_status === '已确认') tags.push({ key: 'confirmed', text: '已确认' })
  else if (ev.verify_status === '有冲突') tags.push({ key: 'unconfirmed', text: '有冲突' })
  else if (ev.event_type !== '报告') tags.push({ key: 'unconfirmed', text: '尚未确认' })
  if (ev.event_type === '医嘱') tags.push({ key: 'unverified', text: '未经核实' })
  return tags
}

/* ---------- 记录今天 ---------- */

async function onSave(updateCurrent = false) {
  if (!episode.value || saving.value) return
  saving.value = true
  try {
    const sit = sitIndex.value >= 0 ? SIT_OPTIONS[sitIndex.value].minutes : null
    const activity = activityIndex.value >= 0 ? ACTIVITY_OPTIONS[activityIndex.value].value : null
    const leg = legIndex.value >= 0 ? LEG_OPTIONS[legIndex.value] : null
    await logToday(episode.value.id, {
      sit_minutes: sit,
      planned_activity_done: activity,
      top_worry: worry.value.trim() || null,
      leg_change: leg,
    })
    const extra: string[] = []
    if (changeIndex.value >= 0) extra.push(`与昨天相比：${CHANGE_OPTIONS[changeIndex.value]}`)
    if (activities.value.length > 0) extra.push(`今天做了：${activities.value.join('、')}`)
    if (extra.length > 0) {
      await addCareEvent(episode.value.id, {
        event_type: '行动',
        source_type: '自述',
        raw_text: `记录今天（${beijingDate()}）：${extra.join('；')}（自述，尚未确认）`,
        verify_status: '尚未确认',
        occurred_at: new Date().toISOString(),
      })
    }
    toast('已保存今天的记录')
    if (updateCurrent) {
      router.push('/dashboard')
    } else {
      await load()
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="timeline-page" v-if="auth.isLoggedIn">
    <header class="timeline-page__head">
      <div>
        <h1 class="timeline-page__title">病程</h1>
        <p class="timeline-page__meta">
          本次发作 · {{ onsetLabel }} · {{ stats.records }} 条记录 · {{ stats.reports }} 份报告 ·
          {{ stats.analyses }} 次分析
        </p>
      </div>
      <div class="timeline-page__actions">
        <AppButton type="soft" @click="toast('筛选功能将在后续版本提供')">筛选</AppButton>
        <AppButton type="secondary" @click="router.push('/analysis?input=report')">新增事件</AppButton>
      </div>
    </header>

    <div v-if="loading" class="timeline-page__loading">正在加载…</div>

    <div v-else-if="episode" class="timeline-page__grid">
      <!-- 左：图表 + 时间线 -->
      <section class="timeline-main">
        <AppCard class="chart-card">
          <div class="chart-card__head">
            <h2 class="chart-card__title">最近 14 天 · 每天能坐多久（分钟）</h2>
            <span class="chart-card__source">来自你的记录</span>
          </div>
          <div class="chart">
            <div v-for="(bar, i) in chart" :key="i" class="chart__col">
              <div class="chart__track">
                <div
                  class="chart__bar"
                  :class="{ 'chart__bar--unconfirmed': bar.minutes === null }"
                  :style="{ height: barHeight(bar.minutes) }"
                />
              </div>
              <span class="chart__date">{{ bar.date.slice(5).replace('-', '/') }}</span>
            </div>
          </div>
          <p class="chart-card__note">
            图中变化只反映你的记录，缺失日留空；不代表影像变化或病情恶化。
          </p>
        </AppCard>

        <AppCard class="records-card">
          <h2 class="records-card__title">记录（按事件，保留来源与核实状态）</h2>
          <ol class="timeline">
            <li v-for="group in groups" :key="group.date" class="timeline__group">
              <div class="timeline__date">
                <span class="timeline__dot" aria-hidden="true" />
                <span class="timeline__date-text">
                  {{ group.date === beijingDate() ? '今天' : relativeDayLabel(group.date) }} · {{ group.date }}
                </span>
              </div>
              <div v-for="ev in group.events" :key="ev.id" class="timeline__event">
                <div class="timeline__event-head">
                  <span class="timeline__event-type">{{ eventTypeTag(ev) }}</span>
                  <span v-if="/【系统生成 v(\d+)】/.test(ev.raw_text ?? '')" class="timeline__event-version">
                    {{ (ev.raw_text ?? '').match(/【系统生成 v(\d+)】/)?.[0]?.replace(/【|】/g, '') }}
                  </span>
                </div>
                <p class="timeline__event-text">{{ eventText(ev) }}</p>
                <div class="timeline__event-tags">
                  <StatusTag v-for="(tag, i) in eventTags(ev)" :key="i" :status="tag.key" :text="tag.text" />
                </div>
              </div>
            </li>
          </ol>
        </AppCard>
      </section>

      <!-- 右：记录今天（常驻表单） -->
      <aside class="record-aside">
        <AppCard class="record-card">
          <div class="record-card__head">
            <h2 class="record-card__title">记录今天</h2>
            <span class="record-card__hint">约 1 分钟 · 可跳过</span>
          </div>

          <div class="record-card__field">
            <p class="record-card__label">今天能坐多久？</p>
            <div class="chips">
              <button
                v-for="(opt, i) in SIT_OPTIONS"
                :key="opt.label"
                type="button"
                class="chip"
                :class="{ 'chip--selected': sitIndex === i }"
                @click="sitIndex = sitIndex === i ? -1 : i"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="record-card__field">
            <p class="record-card__label">能否完成原本计划的活动？</p>
            <div class="chips">
              <button
                v-for="(opt, i) in ACTIVITY_OPTIONS"
                :key="opt.label"
                type="button"
                class="chip"
                :class="{ 'chip--selected': activityIndex === i }"
                @click="activityIndex = activityIndex === i ? -1 : i"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="record-card__field">
            <p class="record-card__label">与昨天相比</p>
            <div class="chips">
              <button
                v-for="(opt, i) in CHANGE_OPTIONS"
                :key="opt"
                type="button"
                class="chip"
                :class="{ 'chip--selected': changeIndex === i }"
                @click="changeIndex = changeIndex === i ? -1 : i"
              >
                {{ opt }}
              </button>
            </div>
          </div>

          <div class="record-card__field">
            <p class="record-card__label">今天有腿部麻木或无力吗？</p>
            <p class="record-card__note">不会沿用昨天的答案；不确定请选“尚未确认”。</p>
            <div class="chips">
              <button
                v-for="(opt, i) in LEG_OPTIONS"
                :key="opt"
                type="button"
                class="chip"
                :class="{ 'chip--selected': legIndex === i }"
                @click="legIndex = legIndex === i ? -1 : i"
              >
                {{ opt }}
              </button>
            </div>
          </div>

          <div class="record-card__field">
            <p class="record-card__label">今天做了什么？（可多选）</p>
            <div class="chips">
              <button
                v-for="opt in ACTIVITY_LOG_OPTIONS"
                :key="opt"
                type="button"
                class="chip"
                :class="{ 'chip--selected': activities.includes(opt) }"
                @click="activities = activities.includes(opt) ? activities.filter((a) => a !== opt) : [...activities, opt]"
              >
                {{ opt }}
              </button>
            </div>
          </div>

          <div class="record-card__field">
            <p class="record-card__label">今天最担心什么？</p>
            <textarea
              v-model="worry"
              class="record-card__textarea"
              placeholder="例如：会不会越来越严重…"
            />
          </div>

          <AppButton type="primary" block :loading="saving" @click="onSave(false)">保存记录</AppButton>
          <button type="button" class="record-card__update" @click="onSave(true)">
            保存并更新“当前情况”
          </button>
          <p v-if="todayLogged" class="record-card__logged">今天已记录，可继续补充。</p>
        </AppCard>
      </aside>
    </div>

    <AppCard v-else>
      <p>还没有病程记录。</p>
      <AppButton type="primary" @click="router.push('/dashboard')">去当前情况开始</AppButton>
    </AppCard>
  </div>

  <AppCard v-else>
    <p>登录后查看病程。</p>
    <AppButton type="primary" @click="router.push('/login')">登录 / 注册</AppButton>
  </AppCard>
</template>

<style scoped>
.timeline-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.timeline-page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacing-lg);
}

.timeline-page__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.timeline-page__meta {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.timeline-page__actions {
  display: flex;
  gap: var(--spacing-sm);
}

.timeline-page__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

.timeline-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: var(--spacing-xl);
  align-items: start;
}

.timeline-main {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

/* ---------- 图表 ---------- */
.chart-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
}

.chart-card__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.chart-card__source {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-xs);
  height: 140px;
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
  min-height: 8px;
  background: var(--color-primary);
  border-radius: var(--radius-tag) var(--radius-tag) 0 0;
}

.chart__bar--unconfirmed {
  background: var(--color-warn);
}

.chart__date {
  margin-top: var(--spacing-xs);
  font-size: 11px;
  color: var(--color-text-3);
}

.chart-card__note {
  margin: var(--spacing-md) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

/* ---------- 时间线 ---------- */
.records-card__title {
  margin: 0 0 var(--spacing-lg);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.timeline {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.timeline__date {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.timeline__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
}

.timeline__date-text {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.timeline__event {
  margin-left: var(--spacing-xs);
  padding: var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  margin-bottom: var(--spacing-sm);
}

.timeline__event-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.timeline__event-type {
  font-size: var(--font-size-aux-sm);
  color: var(--color-info);
  font-weight: var(--font-weight-medium);
}

.timeline__event-version {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.timeline__event-text {
  margin: var(--spacing-xs) 0 var(--spacing-sm);
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

.timeline__event-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

/* ---------- 记录今天 ---------- */
.record-aside {
  position: sticky;
  top: 88px;
  min-width: 0;
}

.record-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.record-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.record-card__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.record-card__hint {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.record-card__field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.record-card__label {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}

.record-card__note {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.chip {
  min-height: 32px;
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-text-1);
  cursor: pointer;
}

.chip--selected {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-surface);
}

.record-card__textarea {
  width: 100%;
  min-height: 72px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  resize: vertical;
}

.record-card__update {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.record-card__logged {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-ok);
}

@media (max-width: 1100px) {
  .timeline-page__grid {
    grid-template-columns: 1fr;
  }

  .record-aside {
    position: static;
  }
}
</style>
