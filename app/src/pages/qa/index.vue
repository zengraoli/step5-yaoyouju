<script setup lang="ts">
/**
 * A09 问与解释（设计稿 docs/design/app/A09.png，设计宽度 375，主 Tab）
 *
 * 基于当前上下文回答追问并引用来源；越界问题（诊断 / 手术 / 用药）明确不答，
 * 并可一键加入复诊问题；反复求保证时给出稳定解释并结束本轮。
 *
 * 数据全部来自 server 接口：
 * - POST /qa/sessions              创建会话（关联当前病程）
 * - GET  /qa/sessions              历史会话
 * - GET  /qa/sessions/{id}         会话详情
 * - POST /qa/sessions/{id}/messages 提问
 * - POST /qa/sessions/{id}/close   结束本轮（小结）
 * - GET  /episodes                 当前病程（上下文说明）
 * - GET  /episodes/{id}/structured 报告日期（上下文说明）
 */
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { useAuthStore } from '../../stores/auth'
import {
  askQuestion,
  createQaSession,
  getQaSession,
  listQaSessions,
  type QaCitation,
  type QaMessageView,
} from '../../api/qa'
import { listEpisodes } from '../../api/episodes'
import { getStructured } from '../../api/reports'
import { safetyNoticeFromError } from '../../api/analyses'
import { beijingDate, getStatusBarHeight } from '../../utils/system'

/** 建议问题（按设计稿的示例问题，用户点击即提问） */
const SUGGESTIONS = ['复诊时该怎么描述？', '哪些变化要提前就医？', '保守治疗一般多久？']

/** 本地存储键：已加入复诊问题清单的问题（供复诊摘要使用） */
const QUESTIONS_STORAGE_KEY = 'yyj_followup_questions'

const auth = useAuthStore()
const statusBarHeight = ref(0)

const sessionId = ref('')
const messages = ref<QaMessageView[]>([])
const inputText = ref('')
const sending = ref(false)
const errorText = ref('')
/** 本轮上下文说明（基于：当前情况日期 + 报告日期） */
const contextLabel = ref('')
/** 已加入复诊问题清单的问题 */
const addedQuestions = ref<string[]>([])
/** 本轮是否已结束（反复求保证后） */
const roundClosed = ref(false)
/** 滚动锚点（新消息后滚到底部） */
const anchor = ref('')

const answeredCount = computed(() => messages.value.filter((m) => m.role === 'assistant').length)

/** 初始化会话（幂等：已有会话不重复创建）；登录后 / 切回本页时也会走到这里 */
async function initOnce() {
  if (!auth.isLoggedIn || sessionId.value) return
  try {
    await ensureSession()
    await loadContext()
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '初始化失败，请稍后重试'
  }
}

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  addedQuestions.value = readStoredQuestions()
  await initOnce()
})

// Tab 切换 / 从登录页返回时兜底：确保会话已初始化（修复“切 Tab 回来仍是坏的”）
onShow(() => {
  void initOnce()
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

function readStoredQuestions(): string[] {
  const stored = uni.getStorageSync(QUESTIONS_STORAGE_KEY)
  return Array.isArray(stored) ? (stored as string[]) : []
}

/** 取最近一个会话；没有则创建（关联进行中的病程） */
async function ensureSession(): Promise<void> {
  const list = await listQaSessions()
  if (list.length > 0) {
    sessionId.value = list[0].id
    const detail = await getQaSession(sessionId.value)
    messages.value = detail?.messages ?? []
    return
  }
  const episodes = await listEpisodes()
  const active = episodes.find((e) => e.status === '进行中') ?? episodes[0] ?? null
  const created = await createQaSession(active?.id)
  sessionId.value = created.id
  // 服务端返回完整会话（含 messages）；缺省时按空数组兜底，避免把 undefined 当数组
  messages.value = created?.messages ?? []
}

/** 上下文说明：基于最新当前情况与报告日期（数据来自接口） */
async function loadContext(): Promise<void> {
  try {
    const episodes = await listEpisodes()
    const active = episodes.find((e) => e.status === '进行中') ?? episodes[0] ?? null
    if (!active) return
    const detail = await getStructured(active.id)
    const report = detail.items.find((i) => i.report)
    const symptom = detail.items.find((i) => i.event_type === '症状')
    const parts: string[] = []
    if (symptom) parts.push(`${beijingDate(symptom.occurred_at)} 当前情况`)
    if (report?.report?.report_date) parts.push(`${report.report.report_date} 报告`)
    contextLabel.value = parts.join(' + ')
  } catch {
    contextLabel.value = ''
  }
}

/** 提问 */
async function onSend(text?: string) {
  const content = (text ?? inputText.value).trim()
  if (!content || sending.value) return
  if (!auth.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  sending.value = true
  errorText.value = ''
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
    anchor.value = ''
    setTimeout(() => {
      anchor.value = 'anchor-bottom'
    }, 60)
  } catch (e) {
    // 命中红旗：立即展示就医提示，不被会话流程阻断
    const notice = safetyNoticeFromError(e)
    if (notice) {
      const query = [
        `signals=${encodeURIComponent(notice.matched.map((m) => m.label).join('、'))}`,
        `stop=${notice.matched.some((m) => m.severity === 'high') ? '1' : '0'}`,
        `rule=${encodeURIComponent(notice.rule_set_version ?? '')}`,
      ].join('&')
      uni.navigateTo({ url: `/pages/emergency/notice?${query}` })
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
  uni.setStorageSync(QUESTIONS_STORAGE_KEY, addedQuestions.value)
  toast('已加入复诊问题清单')
}

/** 引用标签（来源说明） */
function citeLabel(cite: QaCitation): string {
  return cite.source_label ?? (cite.kind === 'evidence_doc' ? '审核科普' : cite.kind === 'care_event' ? '你的记录' : '一页分析')
}

/**
 * 引用卡片的状态标签：按引用类型映射（不再一律标「报告原文」）。
 * - 一页分析 → 系统生成；证据文档 → 审核科普；病程事件按来源类型（报告原文 / 自述 / 医生记录）
 */
function citeTag(cite: QaCitation): { key: 'quote' | 'self' | 'generated' | 'reviewed'; text: string } {
  if (cite.kind === 'analysis') return { key: 'generated', text: '系统生成' }
  if (cite.kind === 'evidence_doc') return { key: 'reviewed', text: '审核科普' }
  const label = cite.source_label ?? ''
  if (label.includes('报告原文')) return { key: 'quote', text: '报告原文' }
  if (label.includes('医生记录')) return { key: 'self', text: '医生记录' }
  return { key: 'self', text: '自述' }
}

/** 引用中的报告原文（kind = care_event 时展示原文片段） */
function citeQuote(cite: QaCitation): string {
  return cite.statement ?? ''
}

function onOpenHistory() {
  uni.showToast({ title: '历史会话列表将在后续版本提供', icon: 'none' })
}
</script>

<template>
  <view class="page qa-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <text class="nav__title">问与解释</text>
        <view class="nav__history" hover-class="nav__history--hover" :hover-stay-time="80" @click="onOpenHistory">
          <AppIcon name="timeline" :size="22" />
        </view>
      </view>
    </view>

    <!-- 会话区 -->
    <scroll-view class="qa-scroll" scroll-y :scroll-into-view="anchor" scroll-with-animation>
      <!-- 本轮上下文 -->
      <view class="context-banner">
        <view class="context-banner__icon">
          <AppIcon name="info" :size="18" />
        </view>
        <text class="context-banner__text">
          本轮基于：{{ contextLabel || '当前情况' }}。出现新变化请先更新“当前情况”。
        </text>
      </view>

      <view v-for="(m, i) in messages" :id="`msg-${i}`" :key="m.id">
        <!-- 用户消息 -->
        <view v-if="m.role === 'user'" class="bubble bubble--user">
          <text class="bubble__text">{{ m.content }}</text>
        </view>

        <!-- 助手消息 -->
        <view v-else class="bubble bubble--assistant">
          <view class="bubble__avatar">
            <text class="bubble__avatar-text">腰</text>
          </view>
          <view class="bubble__body">
            <text class="bubble__text">{{ m.content }}</text>

            <!-- 引用 -->
            <view v-for="(cite, j) in m.citations" :key="j" class="cite">
              <view class="cite__tags">
                <StatusTag :status="citeTag(cite).key" :text="citeTag(cite).text" />
                <text class="cite__source">来源：{{ citeLabel(cite) }}</text>
              </view>
              <text v-if="citeQuote(cite)" class="cite__quote">“{{ citeQuote(cite) }}”</text>
            </view>

            <!-- 越界拒答：一键加入复诊问题 -->
            <view
              v-if="m.add_to_followup && m.followup_question"
              class="bubble__add"
              hover-class="bubble__add--hover"
              :hover-stay-time="80"
              @click="onAddFollowup(m.followup_question)"
            >
              <AppIcon name="check" :size="14" />
              <text class="bubble__add-text">
                {{ addedQuestions.includes(m.followup_question) ? '已加入复诊问题' : `加入复诊问题：${m.followup_question}` }}
              </text>
            </view>
          </view>
        </view>
      </view>

      <!-- 建议问题 -->
      <view v-if="messages.length === 0" class="suggestions">
        <view
          v-for="s in SUGGESTIONS"
          :key="s"
          class="suggestion"
          hover-class="suggestion--hover"
          :hover-stay-time="80"
          @click="onSend(s)"
        >
          <text class="suggestion__text">{{ s }}</text>
        </view>
      </view>

      <!-- 本轮小结提示 -->
      <view v-if="roundClosed" class="round-note">
        <AppNotice type="warn">
          本轮已解释 {{ answeredCount }} 个问题，行动计划已记录。若没有新信息，反复确认不会得到不同答案；出现新变化时我会重新评估。
        </AppNotice>
      </view>
      <view v-else-if="answeredCount > 0" class="round-note">
        <AppNotice type="info">
          已解释 {{ answeredCount }} 个问题。若没有新信息，反复确认不会得到不同答案。
        </AppNotice>
      </view>

      <view id="anchor-bottom" />
    </scroll-view>

    <!-- 底部输入区 -->
    <view class="qa-input">
      <view class="qa-input__box">
        <input
          v-model="inputText"
          class="qa-input__control"
          placeholder="输入你的问题…"
          placeholder-class="qa-input__placeholder"
          confirm-type="send"
          @confirm="onSend()"
        />
      </view>
      <view
        class="qa-input__send"
        :class="{ 'qa-input__send--disabled': sending || !inputText.trim() }"
        hover-class="qa-input__send--hover"
        :hover-stay-time="80"
        @click="onSend()"
      >
        <AppIcon name="send" :size="22" />
      </view>
    </view>

    <TabBar />
  </view>
</template>

<style lang="scss">
.qa-page {
  min-height: 100vh;
  background-color: $color-bg;
  display: flex;
  flex-direction: column;
}

.qa-scroll {
  flex: 1;
  padding: $spacing-lg $spacing-page 0;
}

/* ---------- 上下文横幅 ---------- */
.context-banner {
  display: flex;
  align-items: flex-start;
  padding: $spacing-md;
  background-color: $color-info-light;
  border-radius: $radius-button;
  margin-bottom: $spacing-lg;
}

.context-banner__icon {
  color: $color-info;
  margin-right: $spacing-xs;
  flex-shrink: 0;
}

.context-banner__text {
  flex: 1;
  font-size: $font-size-aux;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- 消息气泡 ---------- */
.bubble {
  display: flex;
  margin-bottom: $spacing-lg;

  &--user {
    justify-content: flex-end;
  }

  &--assistant {
    align-items: flex-start;
  }
}

.bubble--user .bubble__text {
  display: block;
  max-width: 560rpx;
  padding: $spacing-md;
  background-color: $color-primary;
  color: $color-surface;
  font-size: $font-size-body;
  line-height: $line-height-body;
  border-radius: $radius-card $radius-card $radius-tag $radius-card;
}

.bubble__avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background-color: $color-primary-light;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: $spacing-sm;
}

.bubble__avatar-text {
  font-size: $font-size-tag;
  color: $color-primary;
  font-weight: $font-weight-medium;
}

.bubble__body {
  flex: 1;
  min-width: 0;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card $radius-card $radius-card $radius-tag;
}

.bubble__body .bubble__text {
  display: block;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- 引用 ---------- */
.cite {
  margin-top: $spacing-md;
  padding: $spacing-md;
  background-color: $color-bg;
  border-radius: $radius-button;
}

.cite__tags {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.cite__source {
  font-size: $font-size-aux;
  color: $color-info;
}

.cite__quote {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-body;
  color: $color-primary;
  line-height: $line-height-body;
}

/* ---------- 加入复诊问题 ---------- */
.bubble__add {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  margin-top: $spacing-md;
  color: $color-primary;

  &--hover {
    opacity: 0.75;
  }
}

.bubble__add-text {
  font-size: $font-size-body;
  color: $color-primary;
}

/* ---------- 建议问题 ---------- */
.suggestions {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  margin-bottom: $spacing-lg;
}

.suggestion {
  min-height: 72rpx;
  padding: $spacing-xs $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-primary;
  border-radius: $radius-pill;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;

  &--hover {
    background-color: $color-primary-light;
  }
}

.suggestion__text {
  font-size: $font-size-body;
  color: $color-primary;
}

/* ---------- 本轮提示 ---------- */
.round-note {
  margin-bottom: $spacing-lg;
}

/* ---------- 底部输入 ---------- */
.qa-input {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  padding: $spacing-md $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-md});
  background-color: $color-surface;
  border-top: 2rpx solid $color-border;
}

.qa-input__box {
  flex: 1;
  min-height: 80rpx;
  padding: 0 $spacing-md;
  background-color: $color-bg;
  border-radius: $radius-pill;
  display: flex;
  align-items: center;
}

.qa-input__control {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;

  &__placeholder {
    color: $color-text-3;
  }
}

.qa-input__send {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background-color: $color-primary;
  color: $color-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &--disabled {
    background-color: $color-text-3;
  }

  &--hover {
    opacity: 0.85;
  }
}
</style>
