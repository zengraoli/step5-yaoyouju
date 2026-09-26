<script setup lang="ts">
/**
 * W04 问与解释（设计稿 docs/design/web/W04.png，设计宽度 1440）
 *
 * 左：对话区（基于当前上下文回答并引用来源；越界问题明确不答并可加入复诊问题）；
 * 右：本轮上下文 / 已加入的复诊问题 / 不回答的范围 / 历史会话。
 *
 * 数据全部来自 server 接口：
 * - POST /qa/sessions、GET /qa/sessions、GET /qa/sessions/{id}
 * - POST /qa/sessions/{id}/messages、POST /qa/sessions/{id}/close
 * - GET /episodes、GET /episodes/{id}/structured、GET /analyses/by-episode/{id}
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import {
  askQuestion,
  createQaSession,
  getQaSession,
  listQaSessions,
  type QaMessageView,
  type QaSessionListItem,
} from '@/api/qa'
import { getStructured } from '@/api/reports'
import { getLatestAnalysis } from '@/api/analyses'
import { listEpisodes } from '@/api/episodes'
import { beijingDate } from '@/utils/date'

/** 本地存储键：已加入复诊问题清单 */
const QUESTIONS_KEY = 'yyj_web_followup_questions'

/** 建议问题（按设计稿示例） */
const SUGGESTIONS = ['复诊时该怎么描述？', '哪些变化要提前就医？', '保守治疗一般多久？']

const auth = useAuthStore()
const router = useRouter()

const sessionId = ref('')
const messages = ref<QaMessageView[]>([])
const history = ref<QaSessionListItem[]>([])
const inputText = ref('')
const sending = ref(false)

/** 本轮上下文（右侧栏） */
const context = ref<{ label: string; value: string; tag: 'confirmed' | 'quote' | 'unconfirmed' }[]>([])
/** 已加入的复诊问题（本地清单 + 会话内一键加入） */
const addedQuestions = ref<string[]>([])
/** 本轮是否已结束 */
const roundClosed = ref(false)

onMounted(async () => {
  if (!auth.isLoggedIn) return
  addedQuestions.value = readStoredQuestions()
  await init()
})

function toast(title: string) {
  alert(title)
}

function readStoredQuestions(): string[] {
  try {
    const raw = localStorage.getItem(QUESTIONS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? (arr as string[]) : []
  } catch {
    return []
  }
}

async function init() {
  try {
    const list = await listQaSessions()
    history.value = list.slice(0, 5)
    if (list.length > 0) {
      sessionId.value = list[0].id
      const detail = await getQaSession(sessionId.value)
      messages.value = detail.messages
    } else {
      const episodes = await listEpisodes()
      const active = episodes.find((e) => e.status === '进行中') ?? episodes[0] ?? null
      const created = await createQaSession(active?.id)
      sessionId.value = created.id
      messages.value = created.messages
    }
    await loadContext()
  } catch (e) {
    toast(e instanceof Error ? e.message : '初始化失败，请稍后重试')
  }
}

/** 本轮上下文：当前情况日期 + 报告日期 + 主要困惑 + 腿部无力 */
async function loadContext() {
  try {
    const episodes = await listEpisodes()
    const active = episodes.find((e) => e.status === '进行中') ?? episodes[0] ?? null
    if (!active) return
    const [structured, analysis] = await Promise.all([
      getStructured(active.id).catch(() => null),
      getLatestAnalysis(active.id).catch(() => null),
    ])
    const rows: { label: string; value: string; tag: 'confirmed' | 'quote' | 'unconfirmed' }[] = []
    const symptom = structured?.items.find((i) => i.event_type === '症状')
    if (symptom) {
      rows.push({ label: '当前情况', value: beijingDate(symptom.occurred_at), tag: 'confirmed' })
      const line = symptom.raw_text?.split('\n').find((l) => l.trim().startsWith('3.'))
      const side = line ? line.slice(line.indexOf('？') + 1).trim() : ''
      if (side && side !== '尚未确认') rows.push({ label: '侧别', value: side, tag: 'confirmed' })
      const legLine = symptom.raw_text?.split('\n').find((l) => l.trim().startsWith('2.'))
      const leg = legLine ? legLine.slice(legLine.indexOf('？') + 1).trim() : ''
      rows.push({ label: '腿部无力', value: leg || '尚未回答', tag: 'unconfirmed' })
    }
    const report = structured?.items.find((i) => i.report)
    if (report?.report?.report_date) {
      rows.push({ label: '报告', value: `${report.report.report_date} 腰椎 MRI`, tag: 'quote' })
    }
    if (analysis) {
      rows.push({ label: '主要困惑', value: '报告术语', tag: 'confirmed' })
    }
    context.value = rows
  } catch {
    context.value = []
  }
}

/** 提问 */
async function onSend(text?: string) {
  const content = (text ?? inputText.value).trim()
  if (!content || sending.value) return
  sending.value = true
  try {
    const result = await askQuestion(sessionId.value, content)
    messages.value = [
      ...messages.value,
      {
        id: result.user_message_id,
        role: 'user',
        content,
        citations: [],
        refused: false,
        followup_question: null,
        add_to_followup: false,
        created_at: new Date().toISOString(),
      },
      {
        id: result.message_id,
        role: 'assistant',
        content: result.reply,
        citations: result.citations,
        refused: result.refused,
        followup_question: result.followup_question,
        add_to_followup: result.add_to_followup,
        created_at: new Date().toISOString(),
      },
    ]
    inputText.value = ''
    if (result.close_round) roundClosed.value = true
  } catch (e) {
    // 命中红旗：立即展示就医提示，不被会话流程阻断
    const err = e as { data?: unknown }
    const notice = err?.data as { matched?: { label: string; severity: string }[] } | undefined
    if (notice?.matched) {
      const labels = notice.matched.map((m) => m.label).join('、')
      const stop = notice.matched.some((m) => m.severity === 'high') ? '1' : '0'
      router.push(`/emergency?signals=${encodeURIComponent(labels)}&stop=${stop}`)
    } else {
      toast(e instanceof Error ? e.message : '提问失败，请稍后重试')
    }
  } finally {
    sending.value = false
  }
}

/** 一键加入复诊问题清单 */
function onAddFollowup(question: string) {
  if (!question || addedQuestions.value.includes(question)) {
    toast('该问题已在复诊问题清单中')
    return
  }
  addedQuestions.value = [...addedQuestions.value, question]
  localStorage.setItem(QUESTIONS_KEY, JSON.stringify(addedQuestions.value))
  toast('已加入复诊问题清单')
}

const answeredCount = computed(() => messages.value.filter((m) => m.role === 'assistant').length)
</script>

<template>
  <div class="qa-page" v-if="auth.isLoggedIn">
    <header class="qa-page__head">
      <h1 class="qa-page__title">问与解释</h1>
    </header>

    <div class="qa-page__grid">
      <!-- 左：对话区 -->
      <section class="qa-main">
        <AppNotice type="info">
          本轮基于：当前情况 + 报告 + 最新一页分析。出现新变化请先更新“当前情况”。
        </AppNotice>

        <div class="chat">
          <div v-for="m in messages" :key="m.id" class="chat__row" :class="`chat__row--${m.role}`">
            <template v-if="m.role === 'user'">
              <div class="chat__bubble chat__bubble--user">{{ m.content }}</div>
            </template>
            <template v-else>
              <div class="chat__avatar" aria-hidden="true">腰</div>
              <div class="chat__bubble chat__bubble--assistant">
                <p class="chat__text">{{ m.content }}</p>
                <div v-for="(c, j) in m.citations" :key="j" class="chat__cite">
                  <div class="chat__cite-tags">
                    <StatusTag status="quote" text="报告原文" />
                    <span class="chat__cite-source">来源：{{ c.label ?? '审核科普' }}</span>
                  </div>
                  <p v-if="c.statement" class="chat__cite-quote">“{{ c.statement }}”</p>
                </div>
                <button
                  v-if="m.add_to_followup && m.followup_question"
                  type="button"
                  class="chat__add"
                  @click="onAddFollowup(m.followup_question)"
                >
                  {{
                    addedQuestions.includes(m.followup_question)
                      ? '已加入复诊问题'
                      : `加入复诊问题：${m.followup_question}`
                  }}
                </button>
              </div>
            </template>
          </div>
        </div>

        <!-- 建议问题 -->
        <div class="suggestions">
          <button v-for="s in SUGGESTIONS" :key="s" type="button" class="suggestion" @click="onSend(s)">
            {{ s }}
          </button>
        </div>

        <AppNotice v-if="roundClosed" type="warn">
          本轮已解释 {{ answeredCount }} 个问题，行动计划已记录。若没有新信息，反复确认不会得到不同答案；出现新变化时我会重新评估。
        </AppNotice>
        <AppNotice v-else-if="answeredCount > 0" type="info">
          已解释 {{ answeredCount }} 个问题。若没有新信息，反复确认不会得到不同答案。
        </AppNotice>

        <!-- 输入区 -->
        <div class="composer">
          <input
            v-model="inputText"
            class="composer__input"
            type="text"
            placeholder="输入你的问题…（回车发送）"
            @keyup.enter="onSend()"
          />
          <AppButton type="primary" :disabled="!inputText.trim() || sending" @click="onSend()">发送</AppButton>
        </div>
      </section>

      <!-- 右：上下文与清单 -->
      <aside class="qa-aside">
        <AppCard class="ctx-card">
          <h2 class="ctx-card__title">本轮上下文</h2>
          <ul class="ctx-card__list">
            <li v-for="row in context" :key="row.label" class="ctx-row">
              <span class="ctx-row__label">{{ row.label }}</span>
              <span class="ctx-row__value">{{ row.value }}</span>
              <StatusTag :status="row.tag" :text="row.tag === 'quote' ? '原文' : row.tag === 'confirmed' ? '已确认' : '尚未确认'" />
            </li>
          </ul>
        </AppCard>

        <AppCard class="added-card">
          <div class="added-card__head">
            <h2 class="added-card__title">已加入的复诊问题（{{ addedQuestions.length }}）</h2>
            <AppButton type="soft" @click="router.push('/followup')">去复诊准备整理</AppButton>
          </div>
          <ol v-if="addedQuestions.length > 0" class="added-card__list">
            <li v-for="(q, i) in addedQuestions" :key="i">{{ q }}</li>
          </ol>
          <p v-else class="added-card__empty">在对话中点击“加入复诊问题”，问题会汇总到这里。</p>
        </AppCard>

        <AppCard class="scope-card">
          <h2 class="scope-card__title">这里不会回答的问题</h2>
          <p class="scope-card__desc">
            是否需要手术、用药与剂量、疼痛原因的确定诊断、严重程度评分。这些会被整理为复诊问题。
          </p>
        </AppCard>

        <AppCard class="history-card">
          <h2 class="history-card__title">历史会话</h2>
          <ul class="history-card__list">
            <li v-for="s in history" :key="s.id" class="history-item">
              <span class="history-item__date">{{ s.created_at ? beijingDate(s.created_at) : '' }}</span>
              <span class="history-item__text">{{ s.last_message?.content?.slice(0, 18) || '（空会话）' }}</span>
              <span class="history-item__count">（{{ s.message_count }} 问）</span>
            </li>
          </ul>
          <p v-if="history.length === 0" class="history-card__empty">还没有历史会话。</p>
        </AppCard>
      </aside>
    </div>
  </div>

  <AppCard v-else>
    <p>登录后可以使用问与解释。</p>
    <AppButton type="primary" @click="router.push('/login')">登录 / 注册</AppButton>
  </AppCard>
</template>

<style scoped>
.qa-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.qa-page__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.qa-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--spacing-xl);
  align-items: start;
}

.qa-main {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

/* ---------- 对话 ---------- */
.chat {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.chat__row {
  display: flex;
  gap: var(--spacing-md);
}

.chat__row--user {
  justify-content: flex-end;
}

.chat__bubble {
  max-width: 640px;
  padding: var(--spacing-md);
  border-radius: var(--radius-card);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.chat__bubble--user {
  background: var(--color-primary);
  color: var(--color-surface);
  border-bottom-right-radius: var(--radius-tag);
}

.chat__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-aux-sm);
  font-weight: var(--font-weight-medium);
  flex-shrink: 0;
}

.chat__bubble--assistant {
  flex: 1;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-bottom-left-radius: var(--radius-tag);
}

.chat__text {
  margin: 0;
}

.chat__cite {
  margin-top: var(--spacing-md);
  padding: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
}

.chat__cite-tags {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.chat__cite-source {
  font-size: var(--font-size-aux-sm);
  color: var(--color-info);
}

.chat__cite-quote {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-body);
  color: var(--color-primary);
}

.chat__add {
  margin-top: var(--spacing-md);
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.chat__add:hover {
  text-decoration: underline;
}

/* ---------- 建议问题 ---------- */
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.suggestion {
  min-height: 36px;
  padding: var(--spacing-xs) var(--spacing-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.suggestion:hover {
  background: var(--color-primary-light);
}

/* ---------- 输入区 ---------- */
.composer {
  display: flex;
  gap: var(--spacing-sm);
}

.composer__input {
  flex: 1;
  min-height: 44px;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-body);
}

.composer__input:focus {
  outline: none;
  border-color: var(--color-primary);
}

/* ---------- 右栏 ---------- */
.qa-aside {
  position: sticky;
  top: 88px;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.ctx-card__title,
.added-card__title,
.scope-card__title,
.history-card__title {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.ctx-card__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.ctx-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-aux-sm);
}

.ctx-row:first-child {
  border-top: none;
}

.ctx-row__label {
  color: var(--color-text-2);
  min-width: 64px;
}

.ctx-row__value {
  flex: 1;
  min-width: 0;
}

.added-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.added-card__head .added-card__title {
  margin: 0;
}

.added-card__list {
  margin: 0;
  padding-left: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

.added-card__empty,
.history-card__empty {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.scope-card__desc {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.history-card__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.history-item {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.history-item__date {
  flex-shrink: 0;
}

.history-item__text {
  flex: 1;
  min-width: 0;
  color: var(--color-text-1);
}

@media (max-width: 1100px) {
  .qa-page__grid {
    grid-template-columns: 1fr;
  }

  .qa-aside {
    position: static;
  }
}
</style>
