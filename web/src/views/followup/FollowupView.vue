<script setup lang="ts">
/**
 * W06 复诊准备（设计稿 docs/design/web/W06.png，设计宽度 1440）
 *
 * 左：分段编辑与问题清单排序；右：A4 打印预览（带水印脚注）。
 * 一页交接摘要由你的记录与报告原文整理，保留来源与未核实项；预览后由你自主导出。
 *
 * 数据全部来自 server 接口：
 * - POST /episodes/{id}/followup/generate      生成六段草稿
 * - GET  /episodes/{id}/followup               最新一份摘要
 * - PUT  /episodes/{id}/followup/{summaryId}   预览后纠正
 * - POST /episodes/{id}/followup/{summaryId}/export  导出（文本 / PDF / 图片）
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import {
  correctFollowup,
  exportFollowup,
  generateFollowup,
  getLatestFollowup,
  QUESTIONS_SECTION_KEY,
  type FollowupSection,
  type FollowupSummaryView,
} from '@/api/followup'
import { listEpisodes } from '@/api/episodes'
import { beijingDate } from '@/utils/date'

/** 本地存储键：问与解释加入的复诊问题 */
const QUESTIONS_KEY = 'yyj_web_followup_questions'

/** 三个页签 */
const TABS = ['一页交接摘要', '问题清单', '带什么'] as const

const auth = useAuthStore()
const router = useRouter()

const tab = ref<(typeof TABS)[number]>('一页交接摘要')
const loading = ref(true)
const generating = ref(false)
const episodeId = ref('')
const summary = ref<FollowupSummaryView | null>(null)

/** 编辑中的段 */
const editingKey = ref('')
const editingText = ref('')

/** 问题清单顺序（本地调整） */
const questionOrder = ref<string[]>([])

onMounted(async () => {
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  await init()
})

async function init() {
  loading.value = true
  try {
    const list = await listEpisodes()
    const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
    if (!active) {
      summary.value = null
      return
    }
    episodeId.value = active.id
    // 尚未生成过时返回 null（空状态，不产生 404 噪音）
    summary.value = await getLatestFollowup(active.id).catch(() => null)
    syncQuestions()
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  alert(title)
}

const sections = computed<FollowupSection[]>(() => summary.value?.content.sections ?? [])

/** 问题清单段 */
const questionSection = computed<FollowupSection | undefined>(() =>
  sections.value.find((s) => s.key === QUESTIONS_SECTION_KEY),
)

const questionCount = computed<number>(() => questionSection.value?.items.length ?? 0)

/** 同步问题清单顺序（本地存储 + 摘要段） */
function syncQuestions() {
  const fromSummary = questionSection.value?.items.map((i) => i.text) ?? []
  let fromStorage: string[] = []
  try {
    const raw = localStorage.getItem(QUESTIONS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (Array.isArray(arr)) fromStorage = arr as string[]
  } catch {
    fromStorage = []
  }
  const merged = [...fromStorage, ...fromSummary.filter((t) => !fromStorage.includes(t))]
  questionOrder.value = merged
}

const generatedLabel = computed<string>(() => {
  const at = summary.value?.content.generated_at
  return at ? beijingDate(at) : ''
})

/* ---------- 生成 / 纠正 ---------- */

async function onGenerate() {
  if (!episodeId.value || generating.value) return
  generating.value = true
  try {
    summary.value = await generateFollowup(episodeId.value)
    syncQuestions()
    toast('已生成复诊交接摘要')
  } catch (e) {
    toast(e instanceof Error ? e.message : '生成失败，请稍后重试')
  } finally {
    generating.value = false
  }
}

function onEditSection(section: FollowupSection) {
  editingKey.value = section.key
  editingText.value = section.items.map((i) => i.text).join('\n')
}

function onCancelEdit() {
  editingKey.value = ''
  editingText.value = ''
}

async function onSaveEdit() {
  if (!summary.value) return
  const next: FollowupSection[] = summary.value.content.sections.map((s) => {
    if (s.key !== editingKey.value) return s
    const lines = editingText.value.split('\n').map((l) => l.trim()).filter(Boolean)
    return { ...s, items: lines.map((text, i) => ({ ...(s.items[i] ?? { source: '自述' }), text })) }
  })
  try {
    summary.value = await correctFollowup(episodeId.value, summary.value.id, { sections: next })
    editingKey.value = ''
    syncQuestions()
    toast('已保存你的修改（未核实项仍会保留）')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  }
}

/* ---------- 问题清单排序 ---------- */

function onMoveQuestion(index: number, delta: number) {
  const next = [...questionOrder.value]
  const target = index + delta
  if (target < 0 || target >= next.length) return
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  questionOrder.value = next
  localStorage.setItem(QUESTIONS_KEY, JSON.stringify(next))
}

function onRemoveQuestion(index: number) {
  questionOrder.value = questionOrder.value.filter((_, i) => i !== index)
  localStorage.setItem(QUESTIONS_KEY, JSON.stringify(questionOrder.value))
}

/* ---------- 导出 ---------- */

async function onExportPdf() {
  if (!summary.value) return
  try {
    const result = await exportFollowup(episodeId.value, summary.value.id, 'PDF')
    toast(result.note || '请在打印对话框中选择“另存为 PDF”')
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败，请稍后重试')
  }
}

function onPrint() {
  window.print()
}

async function onCopyText() {
  if (!summary.value) return
  try {
    const result = await exportFollowup(episodeId.value, summary.value.id, '文本')
    await navigator.clipboard?.writeText(result.text).catch(() => undefined)
    toast('摘要文本已复制到剪贴板')
  } catch (e) {
    toast(e instanceof Error ? e.message : '复制失败，请稍后重试')
  }
}

/* ---------- 标签 ---------- */

function itemTags(item: { source: string; verify_status?: string }): { key: 'quote' | 'self' | 'unconfirmed' | 'unverified'; text: string }[] {
  const tags: { key: 'quote' | 'self' | 'unconfirmed' | 'unverified'; text: string }[] = []
  if (item.source === '报告原文') tags.push({ key: 'quote', text: '报告原文' })
  else if (item.source === '医生记录') tags.push({ key: 'self', text: '医生记录' })
  else tags.push({ key: 'self', text: '自述' })
  if (item.verify_status === '尚未确认') tags.push({ key: 'unconfirmed', text: '尚未确认' })
  else if (item.verify_status === '未经核实') tags.push({ key: 'unverified', text: '未经核实' })
  return tags
}

/** 打印预览：六段纯文本 */
const printSections = computed(() => sections.value.filter((s) => s.key !== QUESTIONS_SECTION_KEY))
</script>

<template>
  <div class="followup-page" v-if="auth.isLoggedIn">
    <header class="followup-page__head">
      <div>
        <h1 class="followup-page__title">复诊准备</h1>
        <p class="followup-page__desc">
          一页交接摘要由你的记录与报告原文整理，保留来源与未核实项；预览后由你自主导出。
        </p>
      </div>
      <div class="followup-page__actions">
        <AppButton type="primary" :disabled="!summary" @click="onExportPdf">导出 PDF</AppButton>
        <AppButton type="soft" @click="onPrint">打印</AppButton>
        <AppButton type="soft" :disabled="!summary" @click="onCopyText">复制文本</AppButton>
      </div>
    </header>

    <div v-if="loading" class="followup-page__loading">正在加载…</div>

    <template v-else-if="summary">
      <div class="tabs">
        <button
          v-for="t in TABS"
          :key="t"
          type="button"
          class="tabs__item"
          :class="{ 'tabs__item--active': tab === t }"
          @click="tab = t"
        >
          {{ t }}{{ t === '问题清单' && questionCount > 0 ? `（${questionCount}）` : '' }}
        </button>
      </div>

      <div class="followup-page__grid">
        <!-- 左：编辑区 -->
        <section class="edit-main">
          <p class="edit-main__hint">编辑摘要（每段可纠正，纠正后重新生成）</p>

          <!-- 一页交接摘要 -->
          <template v-if="tab === '一页交接摘要'">
            <AppCard v-for="section in sections" :key="section.key" class="edit-card">
              <div class="edit-card__head">
                <h2 class="edit-card__title">{{ section.title }}</h2>
                <button v-if="editingKey !== section.key" type="button" class="edit-card__correct" @click="onEditSection(section)">
                  <span aria-hidden="true">✎</span> 纠正
                </button>
              </div>
              <template v-if="editingKey !== section.key">
                <div v-for="(item, i) in section.items" :key="i" class="edit-card__item">
                  <p class="edit-card__text">{{ item.text }}</p>
                  <div class="edit-card__tags">
                    <StatusTag v-for="(tag, j) in itemTags(item)" :key="j" :status="tag.key" :text="tag.text" />
                  </div>
                </div>
                <p v-if="section.items.length === 0" class="edit-card__empty">尚未确认</p>
              </template>
              <div v-else class="edit-card__editor">
                <textarea v-model="editingText" class="edit-card__textarea" />
                <div class="edit-card__editor-actions">
                  <AppButton type="soft" @click="onCancelEdit">取消</AppButton>
                  <AppButton type="primary" @click="onSaveEdit">保存</AppButton>
                </div>
              </div>
            </AppCard>
          </template>

          <!-- 问题清单 -->
          <AppCard v-else-if="tab === '问题清单'" class="edit-card">
            <h2 class="edit-card__title">最希望解决的问题（可拖拽排序）</h2>
            <ol class="question-list">
              <li v-for="(q, i) in questionOrder" :key="i" class="question-row">
                <span class="question-row__handle" aria-hidden="true">⠿</span>
                <span class="question-row__index">{{ i + 1 }}</span>
                <span class="question-row__text">{{ q }}</span>
                <span class="question-row__actions">
                  <button type="button" :disabled="i === 0" @click="onMoveQuestion(i, -1)">↑</button>
                  <button type="button" :disabled="i === questionOrder.length - 1" @click="onMoveQuestion(i, 1)">↓</button>
                  <button type="button" class="question-row__remove" @click="onRemoveQuestion(i)">×</button>
                </span>
              </li>
            </ol>
            <p v-if="questionOrder.length === 0" class="edit-card__empty">
              问题清单为空：可在问与解释或一页分析中加入问题。
            </p>
          </AppCard>

          <!-- 带什么 -->
          <AppCard v-else class="edit-card">
            <h2 class="edit-card__title">复诊时可以带上</h2>
            <ul class="bring-list">
              <li v-for="item in ['已录入的检查报告原文', '症状开始时间与最近变化记录', '正在使用的药物与既有医嘱', '本页导出的一页交接摘要']" :key="item">
                {{ item }}
              </li>
            </ul>
          </AppCard>
        </section>

        <!-- 右：打印预览 -->
        <aside class="print-aside">
          <AppCard class="print-card">
            <div class="print-card__meta">
              <span>打印预览 · A4</span>
            </div>
            <div class="print-card__page">
              <div class="print-card__head">
                <h2 class="print-card__title">复诊交接摘要</h2>
                <span class="print-card__badge">腰</span>
              </div>
              <p class="print-card__sub">成于 {{ generatedLabel }} · 由用户自述与报告原文整理 · 未经医生核实</p>
              <template v-for="section in printSections" :key="section.key">
                <h3 class="print-card__section-title">{{ ['一', '二', '三', '四', '五', '六'][printSections.indexOf(section)] }}、{{ section.title }}</h3>
                <p v-for="(item, i) in section.items" :key="i" class="print-card__line">{{ item.text }}</p>
              </template>
              <p class="print-card__foot">
                本摘要整理已有信息，保留时间来源与未核实项，不含诊断结论。腰有据 · 用户自述与报告原文整理，未经医生核实
              </p>
            </div>
          </AppCard>
          <AppNotice type="info">
            导出后由你自行决定是否分享给医生；本产品不会主动把你的健康资料发送给任何第三方。导出文件链接 24 小时内有效。
          </AppNotice>
        </aside>
      </div>
    </template>

    <AppCard v-else>
      <p>还没有复诊摘要。系统会按固定六段整理你的病程，保留未核实项，你可以预览纠正后自行导出。</p>
      <AppButton type="primary" :loading="generating" @click="onGenerate">生成复诊摘要</AppButton>
    </AppCard>
  </div>

  <AppCard v-else>
    <p>登录后可以整理复诊摘要。</p>
    <AppButton type="primary" @click="router.push('/login')">登录 / 注册</AppButton>
  </AppCard>
</template>

<style scoped>
.followup-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.followup-page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacing-lg);
}

.followup-page__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.followup-page__desc {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.followup-page__actions {
  display: flex;
  gap: var(--spacing-sm);
}

.followup-page__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

/* ---------- 页签 ---------- */
.tabs {
  display: flex;
  gap: var(--spacing-xs);
  border-bottom: 1px solid var(--color-border);
}

.tabs__item {
  padding: var(--spacing-sm) var(--spacing-lg);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: var(--font-size-body);
  font-family: inherit;
  color: var(--color-text-2);
  cursor: pointer;
}

.tabs__item--active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.followup-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 460px;
  gap: var(--spacing-xl);
  align-items: start;
}

.edit-main {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.edit-main__hint {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 编辑卡 ---------- */
.edit-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.edit-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.edit-card__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.edit-card__correct {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.edit-card__item + .edit-card__item {
  margin-top: var(--spacing-md);
}

.edit-card__text {
  margin: 0;
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

.edit-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-xs);
}

.edit-card__empty {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-3);
}

.edit-card__textarea {
  width: 100%;
  min-height: 120px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  resize: vertical;
}

.edit-card__editor-actions {
  display: flex;
  gap: var(--spacing-sm);
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

.question-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
  font-size: var(--font-size-aux);
}

.question-row__handle {
  color: var(--color-text-3);
  cursor: grab;
}

.question-row__index {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-aux-sm);
  flex-shrink: 0;
}

.question-row__text {
  flex: 1;
  min-width: 0;
}

.question-row__actions {
  display: flex;
  gap: var(--spacing-xs);
}

.question-row__actions button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-tag);
  background: var(--color-surface);
  color: var(--color-text-2);
  cursor: pointer;
}

.question-row__actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.question-row__remove:hover {
  border-color: var(--color-error);
  color: var(--color-error);
}

/* ---------- 带什么 ---------- */
.bring-list {
  margin: 0;
  padding-left: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

/* ---------- 打印预览 ---------- */
.print-aside {
  position: sticky;
  top: 88px;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.print-card__meta {
  display: flex;
  justify-content: flex-end;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
  margin-bottom: var(--spacing-sm);
}

.print-card__page {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-tag);
  padding: var(--spacing-xxl);
  box-shadow: 0 4px 16px rgba(27, 34, 48, 0.06);
}

.print-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.print-card__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.print-card__badge {
  width: 28px;
  height: 28px;
  border-radius: 20%;
  background: var(--color-primary);
  color: var(--color-surface);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-aux-sm);
}

.print-card__sub {
  margin: var(--spacing-xs) 0 var(--spacing-lg);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.print-card__section-title {
  margin: var(--spacing-md) 0 var(--spacing-xs);
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
}

.print-card__line {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.print-card__foot {
  margin: var(--spacing-lg) 0 0;
  padding-top: var(--spacing-md);
  border-top: 1px dashed var(--color-border);
  font-size: 11px;
  color: var(--color-text-3);
  line-height: var(--line-height-body);
}

@media (max-width: 1100px) {
  .followup-page__grid {
    grid-template-columns: 1fr;
  }

  .print-aside {
    position: static;
  }
}
</style>
