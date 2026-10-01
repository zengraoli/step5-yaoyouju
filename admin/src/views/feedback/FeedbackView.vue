<script setup lang="ts">
/**
 * B06 举报与反馈队列（设计稿 docs/design/admin/B06.png，设计宽度 1440）
 *
 * 按严重度分级；自动附带四类版本与受影响范围；单条授权查看；
 * 处置动作与处理记录。反馈不自动进入训练或内容库。
 *
 * 数据来自 server 接口（/admin/feedback）：
 * - GET  /admin/feedback                 队列（类型 / 状态筛选）
 * - GET  /admin/feedback/{id}            详情（未授权时原始内容不可见）
 * - POST /admin/feedback/{id}/authorize-view  单条授权
 * - POST /admin/feedback/{id}/handle    处置动作与处理记录
 */
import { computed, onMounted, ref } from 'vue';
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { request } from '@/api/request'

interface AffectedUser {
  user_id: string
  phone_masked: string
}

interface FeedbackStats {
  pending: number
  pending_high: number
  pending_medium: number
  pending_low: number
  reviewing: number
  closed: number
  avg_review_days: number | null
  avg_closed_days: number | null
}

interface QueueItem {
  id: string
  type: 'feedback' | 'error_report'
  analysis_id: string | null
  content_item_id: string | null
  help_type: string | null
  unsolved_question: string | null
  category: string | null
  description: string | null
  severity: string | null
  status: string
  versions: {
    analysis_version: number | null
    analysis_id: string | null
    model: { model_release_id: string; model_name: string; prompt_version: string } | null
    content: { content_item_id: string; current_status: string; version: number } | null
    rule_set_version: string
  } | null
  created_at: string
  affected_users: AffectedUser[]
}

interface HandlingRecord {
  id: string
  action: string
  comment: string | null
  actor_id: string | null
  created_at: string
}

interface FeedbackDetail extends QueueItem {
  raw_content: unknown
  authorization: {
    authorized: boolean
    by: string | null
    approved_by?: string | null
    at: string | null
    scope: string | null
    expires_at?: string | null
    expired?: boolean
    revoked?: boolean
    revoked_at?: string | null
    can_revoke?: boolean
    ttl_days?: number
  }
  handling: HandlingRecord[]
  redline: { auto_ingest: false; note: string }
}

/** 处置动作（与服务端 HANDLING_ACTIONS 一致） */
const HANDLING_ACTIONS = ['转内容修正', '转模型复盘', '已回复用户', '无需处理', '关闭']
const TRIAGE_ACTIONS = ['待临床复核', '无需处理', '关闭']

const auth = useAuthStore()

/** 平均处理时长（来自服务端统计，没有记录时显示「暂无」） */
const avgReviewDaysText = computed<string>(() => {
  const v = stats.value.avg_review_days
  return v === null || v === undefined ? '暂无已完成记录' : `平均处理 ${v} 天`
})
const avgClosedDaysText = computed<string>(() => {
  const v = stats.value.avg_closed_days
  return v === null || v === undefined ? '暂无已完成记录' : `平均处理 ${v} 天`
})

const loading = ref(true)
const items = ref<QueueItem[]>([])
const stats = ref({
  pending: 0,
  pendingHigh: 0,
  pendingMedium: 0,
  pendingLow: 0,
  reviewing: 0,
  closed: 0,
  avg_review_days: null as number | null,
  avg_closed_days: null as number | null,
  helpTotal: 0,
  helpUnderstood: 0,
  helpNext: 0,
  helpNone: 0,
})
const tab = ref<'error_report' | 'feedback'>('error_report')
const selectedId = ref('')
const detail = ref<FeedbackDetail | null>(null)
const detailLoading = ref(false)
const handleAction = ref('')
const handleComment = ref('')
const handling = ref(false)
const authorizing = ref(false)
const revoking = ref(false)
/** 初筛（运营编辑） */
const triaging = ref(false)
const triageAction = ref('待临床复核')
const triageComment = ref('')

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  try {
    const res = await request<{ items: QueueItem[]; stats: FeedbackStats }>({
      url: '/admin/feedback',
      data: { type: tab.value },
    })
    items.value = res.items
    stats.value = {
      pending: res.stats.pending,
      pendingHigh: res.stats.pending_high,
      pendingMedium: res.stats.pending_medium,
      pendingLow: res.stats.pending_low,
      reviewing: res.stats.reviewing,
      closed: res.stats.closed,
      avg_review_days: res.stats.avg_review_days,
      avg_closed_days: res.stats.avg_closed_days,
      helpTotal: 0,
      helpUnderstood: 0,
      helpNext: 0,
      helpNone: 0,
    }
    // 帮助类型反馈（近 7 天）单独统计
    const help7d = await request<{ items: QueueItem[] }>({
      url: '/admin/feedback',
      data: { type: 'feedback' },
    })
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
    const recent = help7d.items.filter((i) => new Date(i.created_at).getTime() >= weekAgo)
    stats.value.helpTotal = recent.length
    const pct = (k: string) =>
      recent.length > 0 ? Math.round((recent.filter((i) => i.help_type === k).length / recent.length) * 100) : 0
    stats.value.helpUnderstood = pct('看懂了')
    stats.value.helpNext = pct('知道下一步')
    stats.value.helpNone = pct('都不好')
  } finally {
    loading.value = false
  }
}

function onTabChange(t: 'error_report' | 'feedback') {
  tab.value = t
  void load()
}

/** 查看详情 */
async function onSelect(item: QueueItem) {
  selectedId.value = item.id
  detailLoading.value = true
  detail.value = null
  handleAction.value = ''
  handleComment.value = ''
  try {
    detail.value = await request<FeedbackDetail>({ url: `/admin/feedback/${item.id}` })
  } catch (e) {
    notify(e instanceof Error ? e.message : '加载失败')
  } finally {
    detailLoading.value = false
  }
}

function notify(title: string) {
  globalThis.alert?.(title)
}

/** 单条授权查看 */
async function onAuthorize() {
  if (!detail.value) return
  try {
    detail.value = await request<FeedbackDetail>({
      url: `/admin/feedback/${detail.value.id}/authorize-view`,
      method: 'POST',
      data: { scope: '本条举报涉及的报告与记录' },
    })
    notify('已授权查看（授权人 / 时间 / 范围已写入审计）')
  } catch (e) {
    notify(e instanceof Error ? e.message : '授权失败')
  }
}

/** 处置 */
async function onHandle() {
  if (!detail.value) return
  if (!handleAction.value) {
    notify('请选择处置动作')
    return
  }
  if (!handleComment.value.trim()) {
    notify('请填写处理记录')
    return
  }
  handling.value = true
  try {
    detail.value = await request<FeedbackDetail>({
      url: `/admin/feedback/${detail.value.id}/handle`,
      method: 'POST',
      data: { action: handleAction.value, comment: handleComment.value.trim() },
    })
    notify('已记录处置（写入审计）')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '处置失败')
  } finally {
    handling.value = false
  }
}

/** 举报初筛（运营编辑 / 超级管理）：只流转状态，不看原文、不做临床复核 */
async function onTriage() {
  if (!detail.value) return
  if (!triageAction.value) {
    notify('请选择初筛结论')
    return
  }
  if (!triageComment.value.trim()) {
    notify('请填写初筛记录')
    return
  }
  triaging.value = true
  try {
    detail.value = await request<FeedbackDetail>({
      url: `/admin/feedback/${detail.value.id}/triage`,
      method: 'POST',
      data: { action: triageAction.value, comment: triageComment.value.trim() },
    })
    notify('已记录初筛（写入审计）')
    triageComment.value = ''
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '初筛失败')
  } finally {
    triaging.value = false
  }
}

/** 撤回单条授权（立即生效，写审计） */
async function onRevokeAuthorization() {
  if (!detail.value) return
  revoking.value = true
  try {
    detail.value = await request<FeedbackDetail>({
      url: `/admin/feedback/${detail.value.id}/revoke-view`,
      method: 'POST',
    })
    notify('已撤回单条授权（写入审计）')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '撤回失败')
  } finally {
    revoking.value = false
  }
}

function severityKey(s: string | null): 'conflict' | 'unconfirmed' | 'confirmed' {
  if (s === 'high') return 'conflict'
  if (s === 'medium') return 'unconfirmed'
  return 'confirmed'
}

function severityText(s: string | null): string {
  if (s === 'high') return '高'
  if (s === 'medium') return '中'
  return '低'
}

/** 四类版本摘要 */
function versionsText(item: QueueItem): string {
  const v = item.versions
  if (!v) return '—'
  const parts: string[] = []
  if (v.analysis_version) parts.push(`分析 v${v.analysis_version}`)
  if (v.model) parts.push(v.model.model_name)
  if (v.content) parts.push(`内容版本 ${v.content.current_status} v${v.content.version}`)
  if (v.rule_set_version) parts.push(`规则集 ${v.rule_set_version}`)
  return parts.join(' · ')
}

const affectedText = computed<string>(() => {
  const users = detail.value?.affected_users ?? []
  if (users.length === 0) return '暂未关联到受影响用户'
  return `受影响用户 ${users.length} 人（脱敏统计）`
})
</script>

<template>
  <div class="feedback-page">
    <!-- 统计卡 -->
    <div class="stat-grid">
      <AppCard class="stat-card">
        <p class="stat-card__label">待处理</p>
        <p class="stat-card__value stat-card__value--error">{{ stats.pending }}</p>
        <p class="stat-card__sub">高 {{ stats.pendingHigh }} · 中 {{ stats.pendingMedium }} · 低 {{ stats.pendingLow }}</p>
      </AppCard>
      <AppCard class="stat-card">
        <p class="stat-card__label">临床复核中</p>
        <p class="stat-card__value">{{ stats.reviewing }}</p>
        <p class="stat-card__sub">{{ avgReviewDaysText }}</p>
      </AppCard>
      <AppCard class="stat-card">
        <p class="stat-card__label">本周已关闭</p>
        <p class="stat-card__value">{{ stats.closed }}</p>
        <p class="stat-card__sub">{{ avgClosedDaysText }}</p>
      </AppCard>
      <AppCard class="stat-card">
        <p class="stat-card__label">帮助类型反馈（7 天）</p>
        <p class="stat-card__value">{{ stats.helpTotal }}</p>
        <p class="stat-card__sub">看懂 {{ stats.helpUnderstood }}% · 知道下一步 {{ stats.helpNext }}% · 都不好 {{ stats.helpNone }}%</p>
      </AppCard>
    </div>

    <div class="feedback-grid">
      <!-- 左：队列 -->
      <AppCard class="queue-card">
        <div class="tabs">
          <button
            type="button"
            class="tabs__item"
            :class="{ 'tabs__item--active': tab === 'error_report' }"
            @click="onTabChange('error_report')"
          >
            错误举报（{{ items.length }}）
          </button>
          <button
            type="button"
            class="tabs__item"
            :class="{ 'tabs__item--active': tab === 'feedback' }"
            @click="onTabChange('feedback')"
          >
            帮助类型反馈
          </button>
          <button type="button" class="tabs__item" @click="notify('复述任务为二期功能，当前未开放')">复述任务抽查</button>
        </div>

        <div v-if="loading" class="queue-card__loading">正在加载…</div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>工单</th>
              <th>类型 · 内容 / 版本 · 用户</th>
              <th>严重度</th>
              <th>状态</th>
              <th>负责人</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in items"
              :key="item.id"
              :class="{ 'table__row--selected': selectedId === item.id }"
              @click="onSelect(item)"
            >
              <td class="table__id">#{{ item.id.slice(0, 8).toUpperCase() }}</td>
              <td class="table__content">
                <p class="table__content-title">{{ item.category ?? item.help_type ?? '反馈' }}</p>
                <p class="table__content-meta">{{ item.description ?? item.unsolved_question ?? '—' }}</p>
                <p class="table__content-versions">{{ versionsText(item) }}</p>
              </td>
              <td>
                <StatusTag v-if="item.type === 'error_report'" :status="severityKey(item.severity)" :text="severityText(item.severity)" />
                <span v-else>—</span>
              </td>
              <td><StatusTag status="unconfirmed" :text="item.status" /></td>
              <td>—</td>
              <td>{{ item.created_at.slice(5, 16).replace('T', ' ') }}</td>
            </tr>
            <tr v-if="items.length === 0">
              <td colspan="6" class="table__empty">没有待处理的{{ tab === 'error_report' ? '举报' : '反馈' }}</td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <!-- 右：详情 -->
      <aside class="detail-aside">
        <AppCard v-if="detailLoading" class="panel">
          <p class="panel__hint">正在加载…</p>
        </AppCard>
        <template v-else-if="detail">
          <AppCard class="panel">
            <div class="panel__head">
              <h2 class="panel__title">
                #{{ detail.id.slice(0, 8).toUpperCase() }} · {{ detail.category ?? detail.help_type }}
                <StatusTag v-if="detail.type === 'error_report'" :status="severityKey(detail.severity)" :text="severityText(detail.severity)" />
              </h2>
            </div>

            <div class="versions">
              <p class="versions__title">受影响版本（自动附带）</p>
              <p class="versions__row">分析 {{ detail.versions?.analysis_id?.slice(0, 8) ?? '—' }} · v{{ detail.versions?.analysis_version ?? '—' }} · {{ detail.created_at.slice(0, 16).replace('T', ' ') }}</p>
              <p class="versions__row">模型 {{ detail.versions?.model?.model_name ?? '尚未关联' }}（{{ detail.versions?.model?.prompt_version ?? '—' }}）</p>
              <p class="versions__row">内容版本 {{ detail.versions?.content ? `${detail.versions.content.current_status} v${detail.versions.content.version}` : '尚未关联内容' }}</p>
              <p class="versions__row">规则集 {{ detail.versions?.rule_set_version ?? '—' }}</p>
              <p class="versions__row">受影响范围 {{ affectedText }}</p>
            </div>

            <div class="raw">
              <p class="raw__title">用户描述</p>
              <p class="raw__text">{{ detail.description ?? detail.unsolved_question ?? '—' }}</p>
            </div>

            <div class="authorize">
              <p class="authorize__title">
                <StatusTag v-if="detail.authorization.authorized" status="confirmed" text="已授权" />
                <StatusTag v-else status="unconfirmed" text="未授权" />
                <template v-if="detail.authorization.authorized">
                  单条授权：由临床审核申请、超级管理员审批后生效（{{ detail.authorization.at ? detail.authorization.at.slice(0, 10) : '—' }}
                  <template v-if="detail.authorization.expires_at"> · 有效至 {{ String(detail.authorization.expires_at).slice(0, 10) }}</template>），可随时撤回
                </template>
                <template v-else>
                  单条授权：需临床审核申请、超级管理员审批后才能查看用户原始内容
                </template>
              </p>
              <AppButton
                v-if="auth.hasPermission('feedback.handle') && !detail.authorization.authorized"
                type="soft"
                size="sm"
                :loading="authorizing"
                @click="onAuthorize"
              >
                申请查看用户原始内容（需另一人审批）
              </AppButton>
              <AppButton
                v-if="detail.authorization.can_revoke"
                type="soft"
                size="sm"
                :loading="revoking"
                @click="onRevokeAuthorization"
              >
                撤回单条授权
              </AppButton>
              <span v-if="!auth.hasPermission('feedback.handle')" class="panel__hint">
                当前角色没有申请权限（需要临床审核角色）
              </span>
            </div>
          </AppCard>

          <AppCard class="panel">
            <h2 class="panel__title">处置</h2>
            <div class="handle-actions">
              <button
                v-for="a in HANDLING_ACTIONS"
                :key="a"
                type="button"
                class="handle-chip"
                :class="{ 'handle-chip--selected': handleAction === a }"
                @click="handleAction = a"
              >
                {{ a }}
              </button>
            </div>
            <textarea v-model="handleComment" class="handle-comment" placeholder="处理记录（必填）" />
            <AppButton
              v-if="auth.hasPermission('feedback.triage')"
              type="soft"
              size="sm"
              :loading="triaging"
              @click="onTriage"
            >
              提交初筛（运营编辑）
            </AppButton>
            <AppButton
              v-if="auth.hasPermission('feedback.handle')"
              type="primary"
              size="sm"
              :loading="handling"
              @click="onHandle"
            >
              提交临床复核处置
            </AppButton>
            <p v-if="!auth.hasPermission('feedback.triage') && !auth.hasPermission('feedback.handle')" class="panel__hint">
              当前角色没有举报处置权限（初筛需要运营编辑 / 超级管理，临床复核需要临床审核）。
            </p>

            <div v-if="auth.hasPermission('feedback.triage')" class="handle-triage">
              <p class="handling-log__title">举报初筛（只流转状态，不查看原文）</p>
              <div class="handle-actions">
                <button
                  v-for="a in TRIAGE_ACTIONS"
                  :key="a"
                  type="button"
                  class="handle-chip"
                  :class="{ 'handle-chip--selected': triageAction === a }"
                  @click="triageAction = a"
                >
                  {{ a }}
                </button>
              </div>
              <textarea v-model="triageComment" class="handle-comment" placeholder="初筛记录（必填）" />
              <AppButton type="soft" size="sm" :loading="triaging" @click="onTriage">提交初筛</AppButton>
            </div>

            <div class="handling-log">
              <p class="handling-log__title">处理记录</p>
              <p v-for="h in detail.handling" :key="h.id" class="handling-log__item">
                {{ h.created_at.slice(5, 16).replace('T', ' ') }} {{ h.action }}：{{ h.comment ?? '—' }}
              </p>
              <p v-if="detail.handling.length === 0" class="handling-log__item">还没有处理记录</p>
            </div>
          </AppCard>
        </template>
        <AppCard v-else class="panel">
          <p class="panel__hint">在左侧队列选择一条工单查看详情。</p>
        </AppCard>
      </aside>
    </div>

    <AppNotice type="info">
      工单自动附带分析 / 模型 / 内容 / 规则集四类版本；用户标识为匿名内部 ID；明文资料需单条授权后逐次审计查看。反馈只进入质量库，不进入医学证据库。
    </AppNotice>
  </div>
</template>

<style scoped>
.feedback-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

/* ---------- 统计 ---------- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--spacing-md);
}

.stat-card__label {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.stat-card__value {
  margin: var(--spacing-xs) 0;
  font-size: 26px;
  font-weight: var(--font-weight-medium);
}

.stat-card__value--error {
  color: var(--color-error);
}

.stat-card__sub {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 网格 ---------- */
.feedback-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.queue-card {
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.queue-card__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

/* ---------- 页签 ---------- */
.tabs {
  display: flex;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md) 0;
  border-bottom: 1px solid var(--color-border);
}

.tabs__item {
  padding: var(--spacing-sm) var(--spacing-md);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-text-2);
  cursor: pointer;
}

.tabs__item--active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

/* ---------- 表格 ---------- */
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-aux-sm);
}

.table th {
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-2);
  font-weight: var(--font-weight-regular);
  white-space: nowrap;
}

.table td {
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
  cursor: pointer;
}

.table tr:hover td {
  background: var(--color-bg);
}

.table__row--selected td {
  background: var(--color-primary-light);
}

.table__id {
  font-family: ui-monospace, monospace;
  color: var(--color-text-2);
  white-space: nowrap;
}

.table__content {
  max-width: 320px;
}

.table__content-title {
  margin: 0;
  font-weight: var(--font-weight-medium);
}

.table__content-meta {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-2);
}

.table__content-versions {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-3);
  font-size: 11px;
}

.table__empty {
  text-align: center;
  color: var(--color-text-3);
  padding: var(--spacing-xl);
}

/* ---------- 右栏 ---------- */
.detail-aside {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel__title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.panel__hint {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 版本信息 ---------- */
.versions,
.raw,
.authorize {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
}

.versions__title,
.raw__title {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-2);
}

.versions__row {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.raw__text {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.authorize__title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

/* ---------- 处置 ---------- */
.handle-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.handle-chip {
  min-height: 30px;
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  cursor: pointer;
}

.handle-chip--selected {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.handle-comment {
  width: 100%;
  min-height: 64px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  resize: vertical;
}

.handling-log {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--color-border);
}

.handling-log__title {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-2);
}

.handling-log__item {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

@media (max-width: 1200px) {
  .feedback-grid {
    grid-template-columns: 1fr;
  }

  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
