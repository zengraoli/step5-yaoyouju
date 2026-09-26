<script setup lang="ts">
/**
 * W03 一页分析 + 原文对照（设计稿 docs/design/web/W03.png，设计宽度 1440）
 *
 * 左侧 720px 五段分析；右侧报告原文随点击的解释高亮；
 * 「报告未提及」单独列出（不等于「已排除」）。
 *
 * 产品红线：
 * - 每条解释都带来源；系统生成内容带版本号，不标为事实来源；
 * - 缺失即未知、不补写概率；「尚未确认」不会被当作「没有」；
 * - 报告未描述显示「报告未提及」，不显示「已排除」。
 *
 * 数据全部来自 server 接口：
 * - GET  /analyses/by-episode/{id} 或 /analyses/{id}   一页分析
 * - GET  /episodes/{id}/structured                      报告原文与术语位置
 * - POST /episodes/{id}/today-logs 等（录入报告模式）
 * - POST /reports                                       录入报告（粘贴文字）
 * - POST /feedback / POST /feedback/error-report        帮助反馈 / 错误举报
 */
import { computed, onMounted, ref } from 'vue'
import { onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { createAnalysis, getAnalysis, getLatestAnalysis, type AnalysisView } from '@/api/analyses'
import { getStructured, createReport, type StructuredItem } from '@/api/reports'
import { listEpisodes } from '@/api/episodes'
import { submitErrorReport, submitHelpFeedback } from '@/api/feedback'
import { beijingDate } from '@/utils/date'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const POLL_INTERVAL = 2000

const loading = ref(true)
const episodeId = ref('')
const analysis = ref<AnalysisView | null>(null)
const items = ref<StructuredItem[]>([])
const errorText = ref('')

/** 任务轮询（从核对信息页跳入时） */
const taskId = ref('')
const taskStatus = ref<'queued' | 'completed' | 'failed' | ''>('')
const taskReason = ref('')
let timer: number | undefined

/** 录入报告模式（/analysis?input=report） */
const inputMode = ref(false)
const reportText = ref('')
const reportDate = ref(beijingDate())
const examType = ref('MRI')
const savingReport = ref(false)

/** 当前选中解释（右侧原文高亮） */
const selectedExplain = ref(0)
/** 复诊问题勾选 */
const checkedQuestions = ref<number[]>([])
/** 反馈 */
const feedbackDone = ref('')

onMounted(async () => {
  const q = route.query as { task_id?: string; id?: string; input?: string }
  inputMode.value = q.input === 'report'
  if (q.task_id) taskId.value = q.task_id
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  await init()
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

async function init() {
  loading.value = true
  try {
    const list = await listEpisodes()
    const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
    if (!active) {
      errorText.value = '还没有病程记录'
      return
    }
    episodeId.value = active.id
    const q = route.query as { id?: string }
    if (q.id) {
      analysis.value = await getAnalysis(q.id)
    } else {
      analysis.value = await getLatestAnalysis(active.id)
    }
    const structured = await getStructured(active.id).catch(() => null)
    items.value = structured?.items ?? []
    if (taskId.value) {
      taskStatus.value = 'queued'
      void pollTask()
      timer = window.setInterval(() => void pollTask(), POLL_INTERVAL)
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

async function pollTask() {
  if (!taskId.value) return
  try {
    const { getAnalysisTask } = await import('@/api/analyses')
    const task = await getAnalysisTask(taskId.value)
    taskStatus.value = task.status
    if (task.status === 'completed' && task.analysis) {
      analysis.value = task.analysis as unknown as AnalysisView
      stopPolling()
    } else if (task.status === 'failed') {
      taskReason.value = task.reason ?? '分析失败'
      stopPolling()
    }
  } catch {
    stopPolling()
  }
}

function stopPolling() {
  if (timer) window.clearInterval(timer)
  timer = undefined
}

function toast(title: string) {
  alert(title)
}

/* ---------- 派生数据 ---------- */

const meta = computed(() => analysis.value?.sections.meta ?? null)
const known = computed(() => analysis.value?.sections.known ?? [])
const explains = computed(() => analysis.value?.sections.explain ?? [])
const unknowns = computed(() => analysis.value?.sections.unknown ?? [])
const nextItems = computed(() => analysis.value?.sections.next ?? [])
const videos = computed(() => analysis.value?.sections.videos ?? [])

const reportItem = computed<StructuredItem | undefined>(() => items.value.find((i) => i.report))
const reportRawText = computed<string>(() => reportItem.value?.raw_text ?? '')
const reportDateLabel = computed<string>(() => reportItem.value?.report?.report_date ?? '')
const reportLines = computed<string[]>(() => reportRawText.value.split('\n'))

interface Term {
  term: string
  meaning: string
  start: number
  end: number
}
const terms = computed<Term[]>(() => {
  const raw = reportItem.value?.report?.extracted_terms
  return Array.isArray(raw) ? (raw as Term[]) : []
})

/** 当前解释引用到的术语 */
const citedTerms = computed<Term[]>(() => {
  const text = explains.value[selectedExplain.value]?.text ?? ''
  return terms.value.filter((t) => text.includes(t.term))
})

/** 侧别不一致（报告 vs 自述） */
const selfSide = computed<string>(() => {
  const symptom = items.value.find((i) => i.event_type === '症状')
  const line = symptom?.raw_text?.split('\n').find((l) => l.trim().startsWith('3.'))
  if (!line) return ''
  const m = /(左|右)侧/.exec(line.slice(line.indexOf('？') + 1))
  return m ? `${m[1]}侧` : ''
})
const reportSide = computed<string>(() => {
  const m = /(左|右)侧/.exec(reportRawText.value)
  return m ? `${m[1]}侧` : ''
})
const sideMismatch = computed<boolean>(
  () => Boolean(reportSide.value) && Boolean(selfSide.value) && reportSide.value !== selfSide.value,
)

const mismatchTerms = computed<Term[]>(() => {
  if (!sideMismatch.value) return []
  const sideChar = reportSide.value.slice(0, 1)
  return terms.value.filter((t) => t.term.includes(sideChar) || citedTerms.value.includes(t))
})

/** 某行是否高亮 */
function lineHighlight(lineIndex: number): 'cited' | 'mismatch' | '' {
  let start = 0
  for (let i = 0; i < lineIndex; i += 1) start += reportLines.value[i].length + 1
  const lineEnd = start + reportLines.value[lineIndex].length
  const inRange = (t: Term) => t.start < lineEnd && t.end > start
  if (mismatchTerms.value.some(inRange)) return 'mismatch'
  if (citedTerms.value.some(inRange)) return 'cited'
  return ''
}

/** 术语行号 */
function termLine(t: Term): number {
  return reportRawText.value.slice(0, t.start).split('\n').length
}

/** 引导段（数据驱动） */
const intro = computed<string>(() => {
  if (!analysis.value) return ''
  const parts: string[] = []
  const report = known.value.find((k) => k.source === '报告原文')
  if (report) parts.push(`你上传的报告中提到了：${report.text}`)
  const self = known.value.find((k) => k.source === '自述')
  if (self) parts.push(`你描述：${self.text}`)
  if (unknowns.value.length > 0) parts.push(`还有 ${unknowns.value.length} 项信息尚未确认。`)
  return parts.join('；')
})

/* ---------- 操作 ---------- */

function onSelectExplain(i: number) {
  selectedExplain.value = i
}

function onToggleQuestion(i: number) {
  checkedQuestions.value = checkedQuestions.value.includes(i)
    ? checkedQuestions.value.filter((x) => x !== i)
    : [...checkedQuestions.value, i]
}

/** 加入复诊问题清单（本地存储，供复诊准备页使用） */
function onAddQuestions() {
  const selected = checkedQuestions.value.map((i) => nextItems.value[i]).filter(Boolean)
  localStorage.setItem('yyj_web_followup_questions', JSON.stringify(selected.map((s) => s.text)))
  toast(`已加入复诊问题清单（已选 ${selected.length} 条）`)
}

/** 保存到病程 */
async function onSaveToEpisode() {
  if (!analysis.value || !episodeId.value) return
  try {
    const { addCareEvent } = await import('@/api/episodes')
    await addCareEvent(episodeId.value, {
      event_type: '行动',
      source_type: '自述',
      raw_text: `【系统生成 v${analysis.value.version}】保存了一页分析`,
      verify_status: '尚未确认',
      occurred_at: new Date().toISOString(),
    })
    toast('已保存到病程（标注为系统生成）')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  }
}

/** 导出：复制分析文本 */
async function onExport() {
  if (!analysis.value) return
  const lines: string[] = ['一页分析（系统生成，仅供参考，不作诊断）', '']
  known.value.forEach((k) => lines.push(`已知：${k.text}（${k.source}）`))
  explains.value.forEach((e) => lines.push(`解释：${e.text}（来源：${e.citations.map((c) => c.doc_title).join('、')}）`))
  unknowns.value.forEach((u) => lines.push(`未知：${u}`))
  nextItems.value.forEach((n) => lines.push(`下一步：${n.text}`))
  await navigator.clipboard?.writeText(lines.join('\n')).catch(() => undefined)
  toast('分析文本已复制到剪贴板')
}

/** 分享：复制当前链接 */
async function onShare() {
  await navigator.clipboard?.writeText(window.location.href).catch(() => undefined)
  toast('链接已复制')
}

/** 报告错误：内联举报面板 */
const reportPanel = ref(false)
const reportTypes = ref<string[]>(['与我的报告不符'])
const reportDesc = ref('')
const REPORT_TYPE_OPTIONS = ['事实错误', '与我的报告不符', '缺少重要就医提示', '左右侧/日期混淆', '看不懂', '其他']

async function onSubmitReport() {
  if (!reportDesc.value.trim()) {
    toast('请填写具体描述')
    return
  }
  try {
    await submitErrorReport({
      analysis_id: analysis.value?.id,
      category: reportTypes.value.join('、') || '其他',
      description: reportDesc.value.trim(),
      severity: 'medium',
    })
    toast('已收到举报（会自动附带四类版本）')
    reportPanel.value = false
  } catch (e) {
    toast(e instanceof Error ? e.message : '提交失败，请稍后重试')
  }
}

/** 帮助类型反馈 */
async function onHelp(value: string) {
  if (!analysis.value || feedbackDone.value) return
  try {
    await submitHelpFeedback({ analysis_id: analysis.value.id, help_type: value as '看懂了' | '知道下一步' | '都不好' })
    feedbackDone.value = value
    toast('已收到你的反馈（不会自动进入训练或内容库）')
  } catch (e) {
    toast(e instanceof Error ? e.message : '反馈提交失败，请稍后重试')
  }
}

/** 生成一页分析（空状态按钮） */
async function onGenerate() {
  if (!episodeId.value) {
    const list = await listEpisodes()
    episodeId.value = (list.find((e) => e.status === '进行中') ?? list[0])?.id ?? ''
  }
  if (!episodeId.value) {
    toast('还没有病程记录')
    return
  }
  try {
    const result = await createAnalysis({ episode_id: episodeId.value })
    if (result.status === 'queued') {
      router.push(`/analysis?task_id=${encodeURIComponent(result.task_id)}`)
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '生成分析失败')
  }
}

/** 录入报告（粘贴文字） */
async function onSaveReport() {
  if (!episodeId.value || !reportText.value.trim()) {
    toast('请粘贴报告文字')
    return
  }
  savingReport.value = true
  try {
    await createReport({
      episode_id: episodeId.value,
      report_date: reportDate.value || null,
      raw_text: reportText.value.trim(),
      source_type: '报告原文',
    })
    toast('报告已录入')
    inputMode.value = false
    reportText.value = ''
    await init()
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  } finally {
    savingReport.value = false
  }
}
</script>

<template>
  <div class="analysis-page">
    <!-- 页头 -->
    <header class="analysis-page__head">
      <div>
        <h1 class="analysis-page__title">一页分析</h1>
        <p class="analysis-page__meta">
          基于 {{ meta?.generated_at ? beijingDate(meta.generated_at) : '尚未确认' }} 的信息 ·
          分析版本 v{{ analysis?.version ?? '—' }} · 模型 {{ meta?.model_release ?? '—' }} · 内容库 2026-09
        </p>
      </div>
      <div class="analysis-page__actions">
        <AppButton type="soft" @click="onExport">导出</AppButton>
        <AppButton type="soft" @click="onShare">分享</AppButton>
        <AppButton type="secondary" @click="reportPanel = !reportPanel">报告错误</AppButton>
      </div>
    </header>

    <div v-if="loading" class="analysis-page__loading">正在加载…</div>

    <!-- 录入报告模式 -->
    <AppCard v-else-if="inputMode" class="report-input">
      <h2 class="report-input__title">录入报告（粘贴文字）</h2>
      <p class="report-input__desc">
        原文仅用于对照解释。本产品不做影像读片诊断，也不会把报告中未描述的内容写成“已排除”。
      </p>
      <label class="report-input__label">检查报告原文</label>
      <textarea v-model="reportText" class="report-input__textarea" placeholder="如：腰椎MRI平扫：L4/5椎间盘轻度膨出；L5/S1椎间盘向后突出，相应硬膜囊受压，右侧神经根受压可能…" />
      <div class="report-input__row">
        <label class="report-input__label">报告日期<input v-model="reportDate" type="date" class="report-input__date" /></label>
        <label class="report-input__label">检查类型
          <select v-model="examType" class="report-input__select">
            <option>MRI</option>
            <option>CT</option>
            <option>X 光</option>
            <option>超声</option>
            <option>其他</option>
          </select>
        </label>
      </div>
      <AppButton type="primary" :loading="savingReport" @click="onSaveReport">保存并核对</AppButton>
    </AppCard>

    <template v-else-if="analysis">
      <div class="analysis-page__tags">
        <StatusTag status="no-diagnosis" text="不作诊断" />
        <StatusTag status="generated" text="每条解释带来源" />
        <StatusTag status="unconfirmed" text="缺失即未知" />
      </div>

      <div class="analysis-page__grid">
        <!-- 左侧：五段分析 -->
        <section class="analysis-main">
          <p v-if="intro" class="analysis-main__intro">{{ intro }}</p>

          <!-- ① 当前确认的信息与来源 -->
          <AppCard class="section-card">
            <h2 class="section-card__title"><span class="section-card__badge">1</span>当前确认的信息与来源</h2>
            <ul class="known-list">
              <li v-for="(item, i) in known" :key="i" class="known-item">
                <span class="known-item__text">{{ item.text }}</span>
                <span class="known-item__tags">
                  <StatusTag :status="item.source === '报告原文' ? 'quote' : item.source === '医生记录' ? 'self' : 'self'" :text="item.source" />
                  <span v-if="item.source === '报告原文'" class="known-item__aux">可回看原文</span>
                  <span v-else-if="/尚未确认/.test(item.text)" class="known-item__aux known-item__aux--warn">未经核实</span>
                </span>
              </li>
            </ul>
          </AppCard>

          <!-- ② 这些信息能支持什么解释 -->
          <AppCard class="section-card">
            <h2 class="section-card__title"><span class="section-card__badge">2</span>这些信息能支持什么解释</h2>
            <div
              v-for="(item, i) in explains"
              :key="i"
              class="explain-item"
              :class="{ 'explain-item--active': selectedExplain === i }"
              @click="onSelectExplain(i)"
            >
              <p class="explain-item__text">{{ item.text }}</p>
              <div class="explain-item__cites">
                <span v-for="(c, j) in item.citations" :key="j" class="explain-item__cite">
                  来源：{{ c.doc_title }}
                  <template v-if="/第\s*\d+\s*行|第\d+行/.test(c.statement)"> · 原文相关</template>
                </span>
              </div>
            </div>
          </AppCard>

          <!-- ③ 仍缺哪些信息、哪些不能据此判断 -->
          <AppCard class="section-card">
            <h2 class="section-card__title"><span class="section-card__badge">3</span>仍缺哪些信息、哪些不能据此判断</h2>
            <ul class="unknown-list">
              <li v-for="(item, i) in unknowns" :key="i" class="unknown-item">
                <span class="unknown-item__dot" aria-hidden="true" />
                <span>{{ item }}</span>
              </li>
            </ul>
          </AppCard>

          <!-- ④ 建议向医生确认的问题与下一步 -->
          <AppCard class="section-card">
            <h2 class="section-card__title"><span class="section-card__badge">4</span>建议向医生确认的问题与下一步</h2>
            <ul class="question-list">
              <li v-for="(item, i) in nextItems" :key="i" class="question-item">
                <label>
                  <input v-model="checkedQuestions" type="checkbox" :value="i" @change="onToggleQuestion(i)" />
                  <span>{{ item.text }}</span>
                </label>
              </li>
            </ul>
            <AppButton type="soft" @click="onAddQuestions">加入复诊问题清单（已选 {{ checkedQuestions.length }} 条）</AppButton>
          </AppCard>

          <!-- ⑤ 可选科普视频 -->
          <AppCard class="section-card">
            <h2 class="section-card__title"><span class="section-card__badge">5</span>可选科普视频与本次记录有关</h2>
            <div v-for="(item, i) in videos" :key="i" class="video-row">
              <span class="video-row__play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 6.4 18.6 12l-9.4 5.6z" /></svg>
              </span>
              <span class="video-row__body">
                <span class="video-row__title">{{ item.title }}</span>
                <span class="video-row__meta">
                  <StatusTag status="reviewed" text="已审核 v2" />
                  <span class="video-row__reason">推荐理由：{{ item.reason }}</span>
                </span>
              </span>
              <AppButton type="secondary" @click="toast('视频播放将在内容库页提供')">播放</AppButton>
            </div>
            <p v-if="videos.length === 0" class="section-card__empty">本次没有推荐的科普视频（可在内容库中浏览已审核内容）。</p>
          </AppCard>

          <!-- 操作 -->
          <div class="analysis-actions">
            <AppButton type="secondary" @click="onSaveToEpisode">保存到病程</AppButton>
            <AppButton type="primary" @click="router.push('/followup')">生成复诊摘要</AppButton>
          </div>

          <!-- 反馈 -->
          <AppCard class="feedback-card">
            <p class="feedback-card__title">这次分析对你有帮助吗？</p>
            <div class="feedback-card__chips">
              <button
                v-for="h in ['看懂了', '知道下一步', '都不好，问题没解决']"
                :key="h"
                type="button"
                class="feedback-chip"
                :class="{ 'feedback-chip--selected': feedbackDone === h || (feedbackDone === '都不好' && h.startsWith('都不好')) }"
                @click="onHelp(h.startsWith('都不好') ? '都不好' : h)"
              >
                {{ h }}
              </button>
            </div>
          </AppCard>

          <!-- 举报面板 -->
          <AppCard v-if="reportPanel" class="report-panel">
            <p class="report-panel__title">错误举报（自动附带四类版本）</p>
            <div class="report-panel__types">
              <label v-for="t in REPORT_TYPE_OPTIONS" :key="t" class="report-panel__type">
                <input v-model="reportTypes" type="checkbox" :value="t" />
                <span>{{ t }}</span>
              </label>
            </div>
            <textarea v-model="reportDesc" class="report-panel__desc" placeholder="例如：报告写的是右侧，但解释里说成了左侧……" />
            <AppNotice type="info">你的反馈不会自动进入医学知识库，会由运营编辑和临床审核人员处理。</AppNotice>
            <AppButton type="primary" @click="onSubmitReport">提交举报</AppButton>
          </AppCard>
        </section>

        <!-- 右侧：原文对照 -->
        <aside class="analysis-aside">
          <AppCard v-if="reportItem" class="report-card">
            <div class="report-card__head">
              <h3 class="report-card__title">报告原文 · {{ reportDateLabel }} · {{ examType }}</h3>
              <StatusTag status="self" text="未修改" />
            </div>
            <div class="report-card__body">
              <p
                v-for="(line, i) in reportLines"
                :key="i"
                class="report-card__line"
                :class="{
                  'report-card__line--cited': lineHighlight(i) === 'cited',
                  'report-card__line--mismatch': lineHighlight(i) === 'mismatch',
                }"
              >
                {{ line }}
              </p>
            </div>
            <div class="report-card__legend">
              <span class="legend-item"><span class="legend-dot legend-dot--cited" aria-hidden="true" />当前选中解释引用的原文</span>
              <span v-if="sideMismatch" class="legend-item"><span class="legend-dot legend-dot--mismatch" aria-hidden="true" />与你描述侧别不一致，需向医生确认</span>
            </div>
          </AppCard>

          <AppCard v-if="reportItem" class="mention-card">
            <h3 class="mention-card__title">报告未提及</h3>
            <p class="mention-card__desc">
              神经根水肿、椎管狭窄程度、马尾相关描述。这些内容报告中没有描述，不会被写成“已排除”。
            </p>
          </AppCard>

          <AppCard class="terms-card">
            <h3 class="terms-card__title">本段涉及的术语</h3>
            <ul class="terms-card__list">
              <li v-for="(t, i) in (citedTerms.length > 0 ? citedTerms : terms).slice(0, 6)" :key="i" class="term-row">
                <span class="term-row__head">
                  <span class="term-row__term">{{ t.term }}</span>
                  <span class="term-row__pos">第 {{ termLine(t) }} 行</span>
                </span>
                <span class="term-row__meaning">{{ t.meaning }}</span>
              </li>
            </ul>
          </AppCard>
        </aside>
      </div>
    </template>

    <AppCard v-else>
      <p class="analysis-page__empty-title">{{ errorText || '还没有一页分析' }}</p>
      <p class="analysis-page__empty-desc">确认当前情况后，系统会按固定五段生成一页理性分析。</p>
      <AppButton type="primary" @click="onGenerate">生成一页分析</AppButton>
    </AppCard>

    <!-- 排队 / 失败提示 -->
    <AppNotice v-if="taskStatus === 'queued'" type="info">分析任务排队中，完成后会自动展示。</AppNotice>
    <AppNotice v-else-if="taskStatus === 'failed'" type="warn">
      分析服务暂时不可用（{{ taskReason }}）。你录入的信息已保存，可稍后重试；复诊摘要功能不受影响。
    </AppNotice>
  </div>
</template>


<style scoped>
.analysis-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.analysis-page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacing-lg);
}

.analysis-page__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.analysis-page__meta {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.analysis-page__actions {
  display: flex;
  gap: var(--spacing-sm);
}

.analysis-page__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

.analysis-page__tags {
  display: flex;
  gap: var(--spacing-sm);
}

.analysis-page__grid {
  display: grid;
  grid-template-columns: 720px minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.analysis-main {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.analysis-main__intro {
  margin: 0;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

/* ---------- 段落卡 ---------- */
.section-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.section-card__title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.section-card__badge {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-surface);
  font-size: var(--font-size-aux-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.section-card__empty {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-3);
}

/* ---------- 已知 ---------- */
.known-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.known-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

.known-item__text {
  flex: 1;
  min-width: 0;
}

.known-item__tags {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex-shrink: 0;
}

.known-item__aux {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.known-item__aux--warn {
  color: var(--color-warn);
}

/* ---------- 解释 ---------- */
.explain-item {
  padding: var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.explain-item:hover {
  border-color: var(--color-primary);
}

.explain-item--active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.explain-item__text {
  margin: 0;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.explain-item__cites {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  margin-top: var(--spacing-sm);
}

.explain-item__cite {
  font-size: var(--font-size-aux-sm);
  color: var(--color-info);
}

/* ---------- 未知 ---------- */
.unknown-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.unknown-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

.unknown-item__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-warn);
  margin-top: 7px;
  flex-shrink: 0;
}

/* ---------- 问题清单 ---------- */
.question-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.question-item label {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
  cursor: pointer;
}

.question-item input {
  margin-top: 4px;
}

/* ---------- 视频 ---------- */
.video-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
}

.video-row__play {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-button);
  background: var(--color-primary-light);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.video-row__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.video-row__title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}

.video-row__meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.video-row__reason {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

/* ---------- 操作 / 反馈 ---------- */
.analysis-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.feedback-card__title {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.feedback-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.feedback-chip {
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

.feedback-chip--selected {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

/* ---------- 举报面板 ---------- */
.report-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.report-panel__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.report-panel__types {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
}

.report-panel__type {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-aux);
  cursor: pointer;
}

.report-panel__desc {
  width: 100%;
  min-height: 80px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  resize: vertical;
}

/* ---------- 右侧原文对照 ---------- */
.analysis-aside {
  position: sticky;
  top: 88px;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.report-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.report-card__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.report-card__body {
  padding: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
}

.report-card__line {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-aux);
  line-height: 1.8;
}

.report-card__line--cited {
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.report-card__line--mismatch {
  color: var(--color-warn);
  font-weight: var(--font-weight-medium);
}

.report-card__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  margin-top: var(--spacing-md);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend-dot--cited {
  background: var(--color-primary);
}

.legend-dot--mismatch {
  background: var(--color-warn);
}

.mention-card {
  background: var(--color-warn-light);
  border-color: var(--color-warn);
}

.mention-card__title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.mention-card__desc {
  margin: 0;
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

.terms-card__title {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.terms-card__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.term-row {
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
}

.term-row:first-child {
  border-top: none;
}

.term-row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.term-row__term {
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
  color: var(--color-primary);
}

.term-row__pos {
  font-size: var(--font-size-aux-sm);
  color: var(--color-info);
}

.term-row__meaning {
  display: block;
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

/* ---------- 录入报告 ---------- */
.report-input {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  max-width: 720px;
}

.report-input__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.report-input__desc {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}

.report-input__label {
  display: block;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  margin-bottom: var(--spacing-xs);
}

.report-input__textarea {
  width: 100%;
  min-height: 140px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  resize: vertical;
}

.report-input__row {
  display: flex;
  gap: var(--spacing-lg);
}

.report-input__date,
.report-input__select {
  min-height: 36px;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
}

.analysis-page__empty-title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.analysis-page__empty-desc {
  margin: 0 0 var(--spacing-lg);
  color: var(--color-text-2);
  font-size: var(--font-size-aux);
}

@media (max-width: 1200px) {
  .analysis-page__grid {
    grid-template-columns: 1fr;
  }

  .analysis-aside {
    position: static;
  }
}
</style>
