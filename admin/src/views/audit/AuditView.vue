<script setup lang="ts">
/**
 * B11 审计日志（设计稿 docs/design/admin/B11.png，设计宽度 1440）
 *
 * 筛选；只追加表（时间 / 操作人 / 角色 / 动作 / 对象 / 请求 ID / 哈希）；
 * 哈希链校验；导出需审批。日志中不含明文健康资料，用户仅以匿名标识出现。
 *
 * 数据来自 server 接口：
 * - GET  /admin/audit            列表（筛选 + 分页）
 * - GET  /admin/audit/verify     哈希链校验
 * - POST /admin/audit/export-request   导出申请（需审批）
 */
import { onMounted, ref } from 'vue';
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { request } from '@/api/request'

interface AuditItem {
  id: string
  actor_id: string | null
  actor_name?: string
  actor_role?: string | null
  action: string
  target: string | null
  diff?: unknown
  request_id: string | null
  hash?: string | null
  created_at: string
}

interface AuditList {
  items: AuditItem[]
  total: number
  page: number
  page_size: number
}

interface VerifyResult {
  ok: boolean
  broken_at?: string
  checked?: number
}

const loading = ref(true)
const items = ref<AuditItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const filters = ref({ actor: '全部', role: '全部', action: '全部', target_type: '全部', hours: '168' })
const verify = ref<VerifyResult | null>(null)
const lastVerifiedAt = ref('')

const ACTION_OPTIONS = ['全部', '登录', '内容审核', '内容发布', '开关变更', '授权查看', '处置举报', '审计导出']
const TARGET_OPTIONS = ['全部', '内容', '分析', '开关', '举报', '成员', '证据']
const TIME_OPTIONS = [
  { label: '近 7 天', value: '168' },
  { label: '近 24 小时', value: '24' },
  { label: '近 30 天', value: '720' },
]

onMounted(async () => {
  await Promise.all([load(), verifyChain()])
})

async function load() {
  loading.value = true
  try {
    const res = await request<AuditList>({
      url: '/admin/audit',
      data: {
        page: page.value,
        page_size: pageSize.value,
        action: filters.value.action === '全部' ? undefined : filters.value.action,
        hours: filters.value.hours,
      },
    })
    items.value = res.items
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function verifyChain() {
  try {
    const res = await request<VerifyResult & { checked?: number }>({ url: '/admin/audit/verify' })
    verify.value = res
    lastVerifiedAt.value = new Date().toISOString().slice(0, 16).replace('T', ' ')
  } catch {
    verify.value = null
  }
}

function onFilterChange() {
  page.value = 1
  void load()
}

function notify(title: string) {
  globalThis.alert?.(title)
}

function onRequestExport() {
  notify('导出申请已提交（需超管审批；审批后再次写入审计）')
}

/** 动作徽标色 */
function actionKey(action: string): 'confirmed' | 'unconfirmed' | 'unverified' | 'quote' | 'self' {
  if (action.includes('发布')) return 'confirmed'
  if (action.includes('审核')) return 'quote'
  if (action.includes('授权')) return 'unconfirmed'
  if (action.includes('下线') || action.includes('回滚')) return 'unverified'
  return 'self'
}

function actorLabel(a: AuditItem): { name: string; role: string } {
  const name = a.actor_name ?? (a.actor_id ? `U-${a.actor_id.slice(0, 4).toUpperCase()}…` : '系统')
  return { name, role: a.actor_role ?? '—' }
}

function diffText(a: AuditItem): string {
  if (!a.diff) return '—'
  try {
    const d = typeof a.diff === 'string' ? JSON.parse(a.diff) : a.diff
    return Object.entries(d)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ')
  } catch {
    return '—'
  }
}

const pageCount = (): number => Math.max(1, Math.ceil(total.value / pageSize.value))
</script>

<template>
  <div class="audit-page">
    <!-- 筛选栏 -->
    <AppCard class="filter-bar">
      <div class="filter-bar__row">
        <label class="filter">
          <span>操作人：</span>
          <select v-model="filters.actor" @change="onFilterChange">
            <option>全部</option>
            <option>周工</option>
            <option>李医生</option>
            <option>王编辑</option>
            <option>系统</option>
          </select>
        </label>
        <label class="filter">
          <span>角色：</span>
          <select v-model="filters.role" @change="onFilterChange">
            <option>全部</option>
            <option>技术负责人</option>
            <option>临床审核</option>
            <option>运营编辑</option>
            <option>合规支持</option>
          </select>
        </label>
        <label class="filter">
          <span>动作：</span>
          <select v-model="filters.action" @change="onFilterChange">
            <option v-for="o in ACTION_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="filter">
          <span>对象类型：</span>
          <select v-model="filters.target_type" @change="onFilterChange">
            <option v-for="o in TARGET_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="filter">
          <span>时间：</span>
          <select v-model="filters.hours" @change="onFilterChange">
            <option v-for="o in TIME_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
      </div>
      <div class="filter-bar__right">
        <StatusTag v-if="verify?.ok" status="confirmed" :text="`哈希链完整 · 最近校验 ${lastVerifiedAt}`" />
        <StatusTag v-else-if="verify && !verify.ok" status="conflict" text="哈希链校验失败" />
        <AppButton type="soft" size="sm" @click="verifyChain">重新校验</AppButton>
        <AppButton type="primary" size="sm" @click="onRequestExport">申请导出（需超管审批）</AppButton>
      </div>
    </AppCard>

    <!-- 日志表 -->
    <AppCard class="panel">
      <div v-if="loading" class="panel__loading">正在加载…</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>角色</th>
            <th>动作</th>
            <th>对象 / 变更摘要</th>
            <th>请求 ID</th>
            <th>哈希（前 8 位）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in items" :key="a.id">
            <td class="table__time">{{ a.created_at.slice(0, 16).replace('T', ' ') }}</td>
            <td>{{ actorLabel(a).name }}</td>
            <td>{{ actorLabel(a).role }}</td>
            <td><StatusTag :status="actionKey(a.action)" :text="a.action" /></td>
            <td class="table__target">
              <p class="table__target-id">{{ a.target ?? '—' }}</p>
              <p class="table__target-diff">{{ diffText(a) }}</p>
            </td>
            <td class="table__req">{{ a.request_id ?? '—' }}</td>
            <td class="table__hash">{{ a.hash ? a.hash.slice(0, 8) : '—' }}</td>
          </tr>
          <tr v-if="items.length === 0">
            <td colspan="7" class="table__empty">没有符合条件的审计记录</td>
          </tr>
        </tbody>
      </table>

      <div class="panel__foot">
        <span class="panel__total">共 {{ total.toLocaleString() }} 条 · 每页 {{ pageSize }} 条 · 按月分区归档至对象存储</span>
        <div class="pager">
          <button type="button" :disabled="page <= 1" @click="page -= 1; load()">‹</button>
          <span class="pager__current">{{ page }}</span>
          <button type="button" :disabled="page >= pageCount()" @click="page += 1; load()">›</button>
        </div>
      </div>
    </AppCard>

    <AppNotice type="info">
      审计日志只追加、不可修改、不可删除；每条记录含前序哈希形成链；日志中不含明文健康资料，用户仅以匿名标识出现。导出需超管审批并再次写入审计。
    </AppNotice>
  </div>
</template>

<style scoped>
.audit-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

/* ---------- 筛选 ---------- */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
  flex-wrap: wrap;
}

.filter-bar__row {
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

.filter-bar__right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* ---------- 表格 ---------- */
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.panel__loading {
  padding: var(--spacing-xl);
  text-align: center;
  color: var(--color-text-2);
}

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
  vertical-align: top;
}

.table__time {
  white-space: nowrap;
  color: var(--color-text-2);
}

.table__target {
  max-width: 300px;
}

.table__target-id {
  margin: 0;
  font-family: ui-monospace, monospace;
  color: var(--color-text-1);
  word-break: break-all;
}

.table__target-diff {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-2);
}

.table__req,
.table__hash {
  font-family: ui-monospace, monospace;
  color: var(--color-text-3);
  white-space: nowrap;
}

.table__empty {
  text-align: center;
  color: var(--color-text-3);
  padding: var(--spacing-xl);
}

/* ---------- 分页 ---------- */
.panel__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
  flex-wrap: wrap;
}

.panel__total {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.pager {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.pager button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-tag);
  background: var(--color-surface);
  cursor: pointer;
}

.pager button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pager__current {
  min-width: 28px;
  height: 28px;
  border-radius: var(--radius-tag);
  background: var(--color-primary);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-aux-sm);
}
</style>
