<script setup lang="ts">
/**
 * W02 当前情况（工作台）（设计稿 docs/design/web/W02.png，设计宽度 1440）
 *
 * 三栏：左栏（待确认项优先 + 为你推荐 + 快捷入口）｜中栏（最新一页分析）｜
 * 右栏（计划复诊 + 最近记录 + 就医提示）。
 *
 * 产品红线：
 * - 待确认项优先，缺失显示「尚未确认」，不默认阴性；
 * - 每条解释带来源；系统生成内容带版本号，不标为事实来源；
 * - 就医提示入口在任意位置可达，不被登录阻断。
 *
 * 数据全部来自 server 接口：
 * - GET /episodes、GET /episodes/{id}、GET /episodes/{id}/today、GET /episodes/{id}/structured
 * - GET /analyses/by-episode/{id}   最新一页分析
 * - GET /contents                   为你推荐
 * - POST /episodes/{id}/events      记录待确认项的回答
 */
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import {
  addCareEvent,
  getEpisode,
  getTodayStatus,
  listEpisodes,
  type CareEventView,
  type EpisodeDetail,
} from '@/api/episodes'
import { getStructured, type StructuredItem } from '@/api/reports'
import { getLatestAnalysis, type AnalysisView } from '@/api/analyses'
import { listContents, type ContentListItem } from '@/api/contents'
import { getLatestFollowup, QUESTIONS_SECTION_KEY } from '@/api/followup'
import { beijingDate, relativeDayLabel, weeksSince } from '@/utils/date'

const auth = useAuthStore()
const router = useRouter()

const loading = ref(true)
const episode = ref<EpisodeDetail | null>(null)
const today = ref<{ date: string; logged: boolean } | null>(null)
const structuredItems = ref<StructuredItem[]>([])
const analysis = ref<AnalysisView | null>(null)
const recommends = ref<ContentListItem[]>([])
/** 复诊问题数（来自复诊摘要问题清单段；null = 尚未生成） */
const followupQuestionCount = ref<number | null>(null)
const submitting = ref('')

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
      return
    }
    episode.value = await getEpisode(active.id)
    const [todayRes, structured, latest, contents, followup] = await Promise.all([
      getTodayStatus(active.id).catch(() => null),
      getStructured(active.id).catch(() => null),
      getLatestAnalysis(active.id).catch(() => null),
      listContents().catch(() => [] as ContentListItem[]),
      getLatestFollowup(active.id).catch(() => null),
    ])
    const questionSection = followup?.content.sections.find((s) => s.key === QUESTIONS_SECTION_KEY)
    followupQuestionCount.value = questionSection ? questionSection.items.length : null
    today.value = todayRes ? { date: todayRes.date, logged: todayRes.logged } : null
    structuredItems.value = structured?.items ?? []
    analysis.value = latest
    recommends.value = (contents ?? []).slice(0, 1)
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  alert(title)
}

/* ---------- 左栏：当前情况 ---------- */

const events = computed<CareEventView[]>(() => episode.value?.events ?? [])

/** 最新一条症状事件（A02 写入的结构化摘要） */
const latestSymptom = computed<CareEventView | undefined>(
  () => events.value.find((e) => e.event_type === '症状') ?? undefined,
)

/** 症状摘要中某题的答案（格式与 App 端一致） */
function answerOf(prefix: string): string {
  const text = latestSymptom.value?.raw_text
  if (!text) return '尚未确认'
  const line = text.split('\n').find((l) => l.trim().startsWith(prefix))
  if (!line) return '尚未确认'
  const idx = line.indexOf('？')
  const answer = idx >= 0 ? line.slice(idx + 1).trim() : ''
  return answer || '尚未确认'
}

/** 待确认项（未回答的问题；缺失不默认阴性） */
const pendingQuestions = computed<{ key: string; title: string; options: string[] }[]>(() => {
  const list: { key: string; title: string; options: string[] }[] = []
  if (answerOf('2.') === '尚未确认') {
    list.push({ key: 'leg', title: '今天有腿部麻木或无力吗？', options: ['有', '没有', '尚未确认'] })
  }
  if (answerOf('3.') === '尚未确认') {
    list.push({ key: 'side', title: '报告写“右侧”，你的描述是“左侧”，以你的症状为准？', options: ['左侧', '右侧', '都有 / 不确定'] })
  }
  if (answerOf('1.') === '尚未确认') {
    list.push({ key: 'change', title: '与上次相比，症状有变化吗？', options: ['加重', '差不多', '减轻', '尚未确认'] })
  }
  return list
})

const pendingCount = computed<number>(() => pendingQuestions.value.length)

/** 记录待确认项的回答（自述事件，已确认） */
async function onAnswer(questionKey: string, question: string, answer: string) {
  if (!episode.value || submitting.value) return
  submitting.value = `${questionKey}-${answer}`
  try {
    await addCareEvent(episode.value.id, {
      event_type: '症状',
      source_type: '自述',
      raw_text: `关键变化确认补充：${question} ${answer}`,
      verify_status: '已确认',
      occurred_at: new Date().toISOString(),
    })
    toast(`已记录：${answer}`)
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '记录失败，请稍后重试')
  } finally {
    submitting.value = ''
  }
}

/* ---------- 中栏：最新一页分析 ---------- */

const analysisMeta = computed(() => analysis.value?.sections.meta ?? null)
const analysisDate = computed<string>(() => {
  const at = analysisMeta.value?.generated_at ?? analysis.value?.created_at
  return at ? beijingDate(at) : ''
})
const known = computed(() => analysis.value?.sections.known ?? [])
const explains = computed(() => analysis.value?.sections.explain ?? [])
const unknowns = computed(() => analysis.value?.sections.unknown ?? [])

/** 引导段（由已知与未知信息组合，数据驱动） */
const intro = computed<string>(() => {
  if (!analysis.value) return ''
  const parts: string[] = []
  const report = known.value.find((k) => k.source === '报告原文')
  if (report) parts.push(`你上传的报告中提到了：${report.text}`)
  const self = known.value.find((k) => k.source === '自述')
  if (self) parts.push(`你描述：${self.text}`)
  if (unknowns.value.length > 0) {
    parts.push(`还有 ${unknowns.value.length} 项信息尚未确认。`)
  }
  return parts.join('；')
})

/** 生成一页分析（POST /analyses → 跳转一页分析页） */
async function onGenerate() {
  if (!episode.value) return
  try {
    const { createAnalysis } = await import('@/api/analyses')
    const result = await createAnalysis({ episode_id: episode.value.id })
    if (result.status === 'queued') {
      router.push(`/analysis?task_id=${encodeURIComponent(result.task_id)}`)
    } else {
      router.push('/analysis')
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '生成分析失败，请稍后重试')
  }
}

/* ---------- 右栏 ---------- */

/** 计划复诊：从医嘱事件解析「N 周后复查」 */
const revisit = computed<{ date: string; days: number; source: string } | null>(() => {
  const advice = events.value.find((e) => e.event_type === '医嘱' && /复查|复诊/.test(e.raw_text ?? ''))
  if (!advice) return null
  const m = /(\d+)\s*(周|个月|天)后?(复查|复诊)/.exec(advice.raw_text ?? '')
  const base = beijingDate(advice.occurred_at)
  if (!m) return { date: base, days: 0, source: '你录入的医嘱 · 未经核实' }
  const amount = Number(m[1])
  const unit = m[2]
  const d = new Date(`${base}T00:00:00.000+08:00`)
  if (unit === '周') d.setDate(d.getDate() + amount * 7)
  else if (unit === '个月') d.setMonth(d.getMonth() + amount)
  else d.setDate(d.getDate() + amount)
  const target = new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const days = Math.round((d.getTime() - Date.now()) / (24 * 3600 * 1000))
  return { date: target, days, source: `你录入的医嘱“${m[0]}” · 未经核实` }
})

/** 最近记录（时间线最新 5 条） */
const recentRecords = computed(() => {
  const sorted = [...events.value].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
  return sorted.slice(0, 5).map((e) => {
    const date = beijingDate(e.occurred_at)
    const label = relativeDayLabel(date)
    let text = ''
    if (e.event_type === '症状') text = `症状记录 · ${e.raw_text?.split('\n')[1]?.split('？')[1]?.trim() || '已更新'}`
    else if (e.event_type === '报告') text = 'MRI 报告已录入'
    else if (e.event_type === '医嘱') text = `医生建议：${(e.raw_text ?? '').slice(0, 20)}`
    else if (e.event_type === '行动' && /【系统生成/.test(e.raw_text ?? '')) {
      const v = /【系统生成 v(\d+)】/.exec(e.raw_text ?? '')
      text = `一页分析 ${v ? `v${v[1]}` : ''} 已生成`
    } else text = (e.raw_text ?? '').slice(0, 24)
    return { date, label, text, type: e.event_type }
  })
})

/** 头部元信息 */
const headerMeta = computed<string>(() => {
  if (!episode.value) return ''
  const parts = [`本次发作 · 第 ${weeksSince(episode.value.onset_date ?? episode.value.created_at)} 周`]
  const latest = [...events.value].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))[0]
  if (latest) parts.push(`上次记录：${relativeDayLabel(beijingDate(latest.occurred_at))}`)
  if (episode.value.onset_date) {
    // 已确认的确切日期 → 显示确切日期；否则显示「约某月（尚未确认）」
    if (episode.value.onset_certainty === '已确认') {
      parts.push(`起病 ${episode.value.onset_date}（已确认）`)
    } else {
      parts.push(`起病约 ${episode.value.onset_date.slice(0, 7).replace('-', ' 年 ')} 月（尚未确认）`)
    }
  } else {
    parts.push('起病时间尚未确认')
  }
  return parts.join(' · ')
})
</script>

<template>
  <div class="dashboard" v-if="auth.isLoggedIn">
    <!-- 页头 -->
    <header class="dashboard__head">
      <div>
        <h1 class="dashboard__title">当前情况</h1>
        <p class="dashboard__meta">{{ headerMeta }}</p>
      </div>
      <div class="dashboard__actions">
        <AppButton type="soft" @click="router.push('/timeline?record=1')">记录今天</AppButton>
        <AppButton type="secondary" @click="router.push('/analysis?input=report')">录入报告</AppButton>
      </div>
    </header>

    <div v-if="loading" class="dashboard__loading">正在加载…</div>

    <template v-else-if="episode">
      <div class="dashboard__grid">
        <!-- 左栏 -->
        <section class="dashboard__col dashboard__col--left">
          <!-- 待确认项 -->
          <AppCard v-if="pendingCount > 0" class="pending-card">
            <AppNotice type="warn">
              <strong>有 {{ pendingCount }} 项信息尚未确认</strong><br />
              确认后才会生成新的分析；没有回答的问题会记录为“尚未确认”，不会被当作“没有”。
            </AppNotice>
            <div v-for="q in pendingQuestions" :key="q.key" class="pending-question">
              <p class="pending-question__title">{{ q.title }}</p>
              <div class="pending-question__options">
                <button
                  v-for="opt in q.options"
                  :key="opt"
                  type="button"
                  class="option-chip"
                  :disabled="submitting === `${q.key}-${opt}`"
                  @click="onAnswer(q.key, q.title, opt)"
                >
                  {{ opt }}
                </button>
              </div>
            </div>
            <AppButton type="primary" block @click="load">确认并更新当前情况</AppButton>
          </AppCard>

          <!-- 为你推荐 -->
          <AppCard v-if="recommends.length > 0" class="recommend-card">
            <p class="recommend-card__label">为你推荐（原因：{{ recommends[0].recommend_reason }}）</p>
            <div class="recommend-card__item">
              <span class="recommend-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 6.4 18.6 12l-9.4 5.6z" /></svg>
              </span>
              <span class="recommend-card__body">
                <span class="recommend-card__title">{{ recommends[0].title }}</span>
                <span class="recommend-card__meta">
                  <StatusTag status="reviewed" :text="`已审核 v${recommends[0].version ?? 1}`" />
                  <span class="recommend-card__duration">2:10 · 字幕</span>
                </span>
              </span>
            </div>
          </AppCard>

          <!-- 快捷入口 -->
          <div class="quick-grid">
            <AppCard
              v-for="entry in [
                { key: 'today', title: '记录今天', desc: '约 1 分钟 · 允许跳过', path: '/timeline?record=1' },
                { key: 'report', title: '录入报告', desc: '粘贴文字 · 原文对照', path: '/analysis?input=report' },
                { key: 'qa', title: '问与解释', desc: '基于当前上下文', path: '/qa' },
                { key: 'followup', title: '复诊准备', desc: followupQuestionCount === null ? '一页摘要，可导出' : `${followupQuestionCount} 个问题待确认`, path: '/followup' },
              ]"
              :key="entry.key"
              class="quick-card"
              padded
            >
              <button type="button" class="quick-card__btn" @click="router.push(entry.path)">
                <span class="quick-card__title">{{ entry.title }}</span>
                <span class="quick-card__desc">{{ entry.desc }}</span>
              </button>
            </AppCard>
          </div>
        </section>

        <!-- 中栏：最新一页分析 -->
        <section class="dashboard__col dashboard__col--middle">
          <AppCard class="analysis-card">
            <template v-if="analysis">
              <div class="analysis-card__head">
                <span class="analysis-card__version">v{{ analysis.version }} · {{ analysisDate }}</span>
                <StatusTag status="no-diagnosis" text="不作诊断" />
              </div>
              <p class="analysis-card__intro">{{ intro }}</p>

              <div class="analysis-section">
                <p class="analysis-section__title"><StatusTag status="confirmed" text="已知" /></p>
                <ul class="analysis-section__list">
                  <li v-for="(item, i) in known.slice(0, 3)" :key="i">
                    {{ item.text }}
                    <StatusTag :status="item.source === '报告原文' ? 'quote' : 'self'" :text="item.source" />
                  </li>
                </ul>
              </div>

              <div class="analysis-section">
                <p class="analysis-section__title"><StatusTag status="quote" text="解释" /></p>
                <ul class="analysis-section__list">
                  <li v-for="(item, i) in explains.slice(0, 2)" :key="i">
                    {{ item.text }}
                    <span class="analysis-section__cite">来源：{{ item.citations[0]?.doc_title ?? '尚未确认' }}</span>
                  </li>
                </ul>
              </div>

              <div class="analysis-section">
                <p class="analysis-section__title"><StatusTag status="unconfirmed" text="未知" /></p>
                <ul class="analysis-section__list">
                  <li v-for="(item, i) in unknowns.slice(0, 2)" :key="i">{{ item }}</li>
                </ul>
              </div>

              <div class="analysis-card__footer">
                <AppButton type="secondary" @click="router.push(`/analysis?id=${analysis.id}`)">
                  查看完整分析与原文对照
                </AppButton>
                <AppButton type="soft" @click="router.push('/qa')">继续追问</AppButton>
                <AppButton type="primary" @click="router.push('/followup')">生成复诊摘要</AppButton>
              </div>
            </template>
            <template v-else>
              <p class="analysis-card__empty-title">还没有一页分析</p>
              <p class="analysis-card__empty-desc">
                确认当前情况后，系统会按固定五段生成一页理性分析：已知 / 解释 / 未知 / 下一步 / 视频。
              </p>
              <AppButton type="primary" @click="onGenerate">生成一页分析</AppButton>
            </template>
          </AppCard>
        </section>

        <!-- 右栏 -->
        <section class="dashboard__col dashboard__col--right">
          <AppCard v-if="revisit" class="revisit-card">
            <p class="revisit-card__label">计划复诊</p>
            <p class="revisit-card__date">
              {{ revisit.date }}<span class="revisit-card__days">（约 {{ revisit.days }} 天后）</span>
            </p>
            <p class="revisit-card__source">来源：{{ revisit.source }}</p>
            <button type="button" class="revisit-card__edit" @click="toast('日期修改功能将在后续版本提供')">修改日期</button>
          </AppCard>

          <AppCard class="recent-card">
            <p class="recent-card__title">最近记录</p>
            <ul class="recent-card__list">
              <li v-for="(r, i) in recentRecords" :key="i" class="recent-card__item">
                <span class="recent-card__date">{{ r.label }}</span>
                <span class="recent-card__dot" :class="`recent-card__dot--${r.type}`" aria-hidden="true" />
                <span class="recent-card__text">{{ r.text }}</span>
              </li>
            </ul>
          </AppCard>

          <div class="emergency-inline">
            <AppNotice type="error">
              症状突然变化或出现严重信号？无需登录也可<RouterLink to="/emergency">查看就医提示</RouterLink>。
            </AppNotice>
          </div>
        </section>
      </div>
    </template>

    <AppCard v-else>
      <p class="dashboard__empty-title">还没有病程记录</p>
      <p class="dashboard__empty-desc">从当前关键变化确认开始，系统会按事件整理你的病程，保留来源与核实状态。</p>
      <AppButton type="primary" @click="router.push('/dashboard')">刷新</AppButton>
    </AppCard>
  </div>

  <AppCard v-else>
    <p class="dashboard__empty-title">登录后查看当前情况</p>
    <AppButton type="primary" @click="router.push('/login')">登录 / 注册</AppButton>
  </AppCard>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.dashboard__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacing-lg);
}

.dashboard__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.dashboard__meta {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.dashboard__actions {
  display: flex;
  gap: var(--spacing-sm);
}

.dashboard__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

.dashboard__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, 0.85fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.dashboard__col {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

/* ---------- 待确认项 ---------- */
.pending-card {
  background: var(--color-warn-light);
  border-color: var(--color-warn);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.pending-question__title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}

.pending-question__options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.option-chip {
  min-height: 36px;
  padding: var(--spacing-xs) var(--spacing-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux);
  font-family: inherit;
  color: var(--color-text-1);
  cursor: pointer;
}

.option-chip:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.option-chip:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ---------- 为你推荐 ---------- */
.recommend-card__label {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.recommend-card__item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.recommend-card__icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-button);
  background: var(--color-primary-light);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.recommend-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.recommend-card__title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}

.recommend-card__meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.recommend-card__duration {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

/* ---------- 快捷入口 ---------- */
.quick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-md);
}

.quick-card {
  padding: 0;
}

.quick-card__btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-xs);
  padding: var(--spacing-lg);
  background: none;
  border: none;
  border-radius: var(--radius-card);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.quick-card__btn:hover {
  background: var(--color-bg);
}

.quick-card__title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-1);
}

.quick-card__desc {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

/* ---------- 最新一页分析 ---------- */
.analysis-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.analysis-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.analysis-card__version {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.analysis-card__intro {
  margin: 0;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.analysis-section__title {
  margin: 0 0 var(--spacing-sm);
}

.analysis-section__list {
  margin: 0;
  padding-left: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.analysis-section__list li {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.analysis-section__cite {
  font-size: var(--font-size-aux-sm);
  color: var(--color-info);
}

.analysis-card__footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.analysis-card__empty-title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.analysis-card__empty-title + p {
  margin: 0;
  color: var(--color-text-2);
  font-size: var(--font-size-aux);
}

/* ---------- 计划复诊 ---------- */
.revisit-card__label {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.revisit-card__date {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
}

.revisit-card__days {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  font-weight: var(--font-weight-regular);
}

.revisit-card__source {
  margin: var(--spacing-xs) 0 var(--spacing-md);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.revisit-card__edit {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

/* ---------- 最近记录 ---------- */
.recent-card__title {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.recent-card__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.recent-card__item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.recent-card__date {
  flex-shrink: 0;
  color: var(--color-text-2);
  min-width: 40px;
}

.recent-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 7px;
  flex-shrink: 0;
  background: var(--color-text-3);
}

.recent-card__dot--症状 {
  background: var(--color-primary);
}

.recent-card__dot--报告 {
  background: var(--color-info);
}

.recent-card__dot--医嘱 {
  background: var(--color-warn);
}

.recent-card__dot--行动 {
  background: var(--color-ok);
}

.recent-card__text {
  flex: 1;
  min-width: 0;
}

.dashboard__empty-title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.dashboard__empty-desc {
  margin: 0 0 var(--spacing-lg);
  color: var(--color-text-2);
  font-size: var(--font-size-aux);
}

@media (max-width: 1100px) {
  .dashboard__grid {
    grid-template-columns: 1fr;
  }
}
</style>
