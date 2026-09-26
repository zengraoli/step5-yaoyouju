<script setup lang="ts">
/**
 * B07 安全事件与应急开关（设计稿 docs/design/admin/B07.png，设计宽度 1440）
 *
 * 开关（确认要求与最近变更）、事故记录；安全事件表（规则 / 严重度 / 动作 / 来源 / 用户 / 时间）；
 * 规则集版本。本页只显示匿名标识与规则动作，不显示用户的问卷原文。
 *
 * 数据来自 server 接口（/admin/safety）：
 * - GET  /admin/safety/events   安全事件（规则 / 严重度 / 时间筛选）
 * - GET  /admin/safety/rules    红旗规则集（版本 + 规则）
 * - GET  /admin/safety/switches 应急开关（确认要求与最近变更）
 * - PUT  /admin/safety/switches/{key}  变更开关（立即生效，写审计）
 * - GET  /admin/safety/incidents 事故记录（审计派生）
 */
import { computed, onMounted, ref } from 'vue';
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { request } from '@/api/request'

interface SafetyEvent {
  id: string
  rule_code: string
  severity: string
  action: string
  source: string
  user_masked: string
  created_at: string
}

interface EventsResult {
  items: SafetyEvent[]
  total: number
  by_severity: { high: number; medium: number; low: number }
  window_hours: number
}

interface SwitchItem {
  key: string
  enabled: boolean
  reason: string | null
  updated_at: string
  requirement: string
  last_change: { at: string; by: string } | null
}

interface Incident {
  id: string
  severity: string
  date: string
  summary: string
  audit_id: string
}

interface RuleSet {
  rule_set_version: string
  red_flags: { code: string; label: string; severity: string; action: string; advice: string }[]
  out_of_scope: { code: string; category: string; reply: string; followup_question: string }[]
  note: string
}

const auth = useAuthStore()

const events = ref<EventsResult | null>(null)
const switches = ref<SwitchItem[]>([])
const incidents = ref<Incident[]>([])
const ruleSet = ref<RuleSet | null>(null)
const loading = ref(true)
const filters = ref({ rule: '全部', severity: '全部', hours: '168' })
const updating = ref('')

const RULE_OPTIONS = ['全部', 'RF-01', 'RF-02', 'RF-03', 'RF-04', 'RF-05', 'RF-06', 'RF-07', 'SC-01', 'SC-02']
const SEVERITY_OPTIONS = ['全部', '高', '中', '低']
const TIME_OPTIONS = [
  { label: '近 7 天', value: '168' },
  { label: '近 24 小时', value: '24' },
  { label: '近 30 天', value: '720' },
]

const SWITCH_LABELS: Record<string, string> = {
  个性化分析: '个性化分析（一页分析 + 问与解释）',
  视频推荐: '视频推荐',
  拍照提取: '拍照提取（OCR）',
  案例卡片: '案例卡片（二期）',
}

const canManage = computed<boolean>(() => auth.hasPermission('switch.manage'))

onMounted(async () => {
  await loadAll()
})

async function loadAll() {
  loading.value = true
  try {
    const [ev, sw, inc, rules] = await Promise.all([
      request<EventsResult>({ url: '/admin/safety/events', data: { ...filters.value } }),
      request<SwitchItem[]>({ url: '/admin/safety/switches' }),
      request<Incident[]>({ url: '/admin/safety/incidents' }),
      request<RuleSet>({ url: '/admin/safety/rules' }),
    ])
    events.value = ev
    switches.value = sw
    incidents.value = inc
    ruleSet.value = rules
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  void loadAll()
}

function notify(title: string) {
  globalThis.alert?.(title)
}

function confirmAction(message: string): boolean {
  return globalThis.confirm ? globalThis.confirm(message) : true
}

/** 变更开关（需确认；立即生效，写审计） */
async function onToggleSwitch(item: SwitchItem) {
  if (!canManage.value) {
    notify('当前角色无开关管理权限（需要「技术」角色）')
    return
  }
  const next = !item.enabled
  const ok = confirmAction(
    `确认${next ? '开启' : '关闭'}「${SWITCH_LABELS[item.key] ?? item.key}」？确认要求：${item.requirement}。变更立即生效并写入审计。`,
  )
  if (!ok) return
  updating.value = item.key
  try {
    const reason = window.prompt ? window.prompt('变更原因（写入审计）') ?? '' : ''
    await request({
      url: `/admin/safety/switches/${encodeURIComponent(item.key)}`,
      method: 'PUT',
      data: { enabled: next, reason: reason || '后台变更' },
    })
    notify('已变更并写入审计')
    await loadAll()
  } catch (e) {
    notify(e instanceof Error ? e.message : '变更失败')
  } finally {
    updating.value = ''
  }
}

function severityKey(s: string): 'conflict' | 'unconfirmed' | 'confirmed' {
  if (s === '高' || s === 'high') return 'conflict'
  if (s === '中' || s === 'medium') return 'unconfirmed'
  return 'confirmed'
}

function severityText(s: string): string {
  if (s === 'high') return '高'
  if (s === 'medium') return '中'
  if (s === 'low') return '低'
  if (s === '待确认') return '待确认'
  return s
}

const headerSummary = computed<string>(() => {
  if (!events.value) return ''
  const b = events.value.by_severity
  return `24h：高 ${b.high} · 待确认 ${b.medium} · 中 ${b.low}`
})
</script>

<template>
  <div class="safety-page">
    <div class="safety-grid">
      <!-- 左：应急开关 + 事故记录 -->
      <section class="safety-left">
        <AppCard class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><span aria-hidden="true">⏻</span> 应急开关</h2>
            <StatusTag status="conflict" text="高危需双人确认" />
          </div>
          <div class="switch-list">
            <div v-for="s in switches" :key="s.key" class="switch-row">
              <div class="switch-row__info">
                <p class="switch-row__name">{{ SWITCH_LABELS[s.key] ?? s.key }}</p>
                <p class="switch-row__key">{{ s.key }}</p>
                <p class="switch-row__meta">
                  确认：{{ s.requirement }}
                  <template v-if="s.last_change"> · 最近变更 {{ s.last_change.at }} 周工 · {{ s.last_change.by }}</template>
                </p>
              </div>
              <button
                type="button"
                class="switch-row__toggle"
                :class="{ 'switch-row__toggle--on': s.enabled }"
                :disabled="updating === s.key"
                :aria-label="`${s.enabled ? '关闭' : '开启'}${SWITCH_LABELS[s.key] ?? s.key}`"
                @click="onToggleSwitch(s)"
              />
            </div>
          </div>
          <p class="panel__note">
            关闭后：不做个性化分析与对话任务；用户端显示回退页；已审核科普与摘要仍可用。
          </p>
        </AppCard>

        <AppCard class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><span aria-hidden="true">⚠</span> 事故记录</h2>
            <AppButton type="soft" size="sm" @click="notify('事故记录表单将在后续版本提供')">新建</AppButton>
          </div>
          <ul class="incident-list">
            <li v-for="inc in incidents" :key="inc.id" class="incident-item">
              <span class="incident-item__id">{{ inc.id }}</span>
              <StatusTag :status="inc.severity === '高' ? 'conflict' : inc.severity === '中' ? 'unconfirmed' : 'confirmed'" :text="inc.severity" />
              <span class="incident-item__date">{{ inc.date }}</span>
              <span class="incident-item__summary">{{ inc.summary }}</span>
            </li>
            <li v-if="incidents.length === 0" class="incident-item">还没有事故记录</li>
          </ul>
        </AppCard>
      </section>

      <!-- 右：安全事件 + 规则集 -->
      <section class="safety-right">
        <AppCard class="panel">
          <div class="panel__head">
            <h2 class="panel__title">安全事件</h2>
            <span class="panel__summary">{{ headerSummary }}</span>
          </div>
          <div class="filters">
            <label class="filter">
              <span>规则：</span>
              <select v-model="filters.rule" @change="onFilterChange">
                <option v-for="o in RULE_OPTIONS" :key="o" :value="o">{{ o }}</option>
              </select>
            </label>
            <label class="filter">
              <span>严重度：</span>
              <select v-model="filters.severity" @change="onFilterChange">
                <option v-for="o in SEVERITY_OPTIONS" :key="o" :value="o">{{ o }}</option>
              </select>
            </label>
            <label class="filter">
              <span>时间：</span>
              <select v-model="filters.hours" @change="onFilterChange">
                <option v-for="o in TIME_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </label>
          </div>

          <div v-if="loading" class="panel__loading">正在加载…</div>
          <table v-else class="table">
            <thead>
              <tr><th>规则</th><th>严重度</th><th>系统动作（规则版本）</th><th>来源</th><th>用户</th><th>时间</th></tr>
            </thead>
            <tbody>
              <tr v-for="e in events?.items ?? []" :key="e.id">
                <td>{{ e.rule_code }}</td>
                <td><StatusTag :status="severityKey(e.severity)" :text="severityText(e.severity)" /></td>
                <td>{{ e.action }} · {{ ruleSet?.rule_set_version ?? 'rs-1.3' }}</td>
                <td>{{ e.source }}</td>
                <td>{{ e.user_masked }}</td>
                <td>{{ e.created_at.slice(5, 16).replace('T', ' ') }}</td>
              </tr>
              <tr v-if="(events?.items ?? []).length === 0">
                <td colspan="6" class="table__empty">没有符合筛选条件的安全事件</td>
              </tr>
            </tbody>
          </table>
        </AppCard>

        <AppCard class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><span aria-hidden="true">🛡</span> 红旗规则集</h2>
            <div class="panel__head-right">
              <StatusTag status="self" :text="`当前 ${ruleSet?.rule_set_version ?? 'rs-1.3'} · 临床审定 2026-09-10`" />
              <AppButton type="soft" size="sm" @click="notify('规则表详情将在后续版本提供')">查看规则表</AppButton>
            </div>
          </div>
          <p class="panel__note">{{ ruleSet?.note }}</p>
          <AppNotice type="info">
            本页只显示匿名标识与规则动作，不显示用户的问卷原文；高严重级 24 小时内 &gt; 3 例将自动通知临床负责人复盘。
          </AppNotice>
        </AppCard>
      </section>
    </div>
  </div>
</template>

<style scoped>
.safety-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.safety-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.safety-left,
.safety-right {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
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
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.panel__head-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.panel__title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.panel__summary {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.panel__note {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.panel__loading {
  padding: var(--spacing-xl);
  text-align: center;
  color: var(--color-text-2);
}

/* ---------- 开关 ---------- */
.switch-list {
  display: flex;
  flex-direction: column;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-md) 0;
  border-top: 1px solid var(--color-border);
}

.switch-row:first-child {
  border-top: none;
}

.switch-row__info {
  min-width: 0;
}

.switch-row__name {
  margin: 0;
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
}

.switch-row__key {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--color-text-3);
  font-family: ui-monospace, monospace;
}

.switch-row__meta {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.switch-row__toggle {
  width: 44px;
  height: 24px;
  border-radius: var(--radius-pill);
  background: var(--color-border);
  position: relative;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.15s;
}

.switch-row__toggle--on {
  background: var(--color-ok);
}

.switch-row__toggle--on::after {
  content: '';
  position: absolute;
  right: 2px;
  top: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
}

.switch-row__toggle::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
}

.switch-row__toggle:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ---------- 事故记录 ---------- */
.incident-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.incident-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-1);
}

.incident-item__id {
  font-family: ui-monospace, monospace;
  color: var(--color-text-2);
}

.incident-item__date {
  color: var(--color-text-3);
}

.incident-item__summary {
  flex: 1;
  min-width: 0;
  color: var(--color-text-2);
}

/* ---------- 筛选 ---------- */
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-lg);
}

.filter {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.filter select {
  min-height: 30px;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux-sm);
  background: var(--color-surface);
}

/* ---------- 表格 ---------- */
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-aux-sm);
}

.table th {
  text-align: left;
  padding: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-2);
  font-weight: var(--font-weight-regular);
  white-space: nowrap;
}

.table td {
  padding: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

.table__empty {
  text-align: center;
  color: var(--color-text-3);
  padding: var(--spacing-xl);
}

@media (max-width: 1200px) {
  .safety-grid {
    grid-template-columns: 1fr;
  }
}
</style>
