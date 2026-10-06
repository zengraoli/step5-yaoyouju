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
import { computed, onMounted, ref } from 'vue';
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { getAdminToken, getBaseUrl, request } from '@/api/request'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
/** 只有超级管理员能审批审计导出（合规支持只能申请） */
const canApprove = computed<boolean>(() => auth.role === '超级管理员' || auth.hasPermission('*'))
/** 下载按钮只给申请人本人（服务端也会再校验一次） */
function isApplicant(a: { applicant_id?: string | null }): boolean {
  return Boolean(a.applicant_id) && a.applicant_id === auth.admin?.id
}

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
/** 操作人下拉：来自真实成员表（不再写死姓名） */
const actorOptions = ref<string[]>([])

const filters = ref({ actor: '全部', role: '全部', action: '全部', target_type: '全部', hours: '168' })
const verify = ref<VerifyResult | null>(null)
const lastVerifiedAt = ref('')

const ACTION_OPTIONS = ['全部', '登录', '内容审核', '内容发布', '开关变更', '授权查看', '处置举报', '审计导出']
const TARGET_OPTIONS = ['全部', '内容', '分析', '开关', '举报', '成员', '证据']
/** 动作中文选项 → 真实英文动作码（审计存的是英文 code，选中项必须按码查库） */
const ACTION_MAP: Record<string, string[]> = {
  登录: ['admin.login', 'admin.logout', 'admin.login_failed'],
  内容审核: ['content.create_draft', 'content.update_draft', 'content.submit_review', 'content.approve', 'content.reject', 'content.resubmit', 'content.mark_correcting'],
  内容发布: ['content.publish'],
  开关变更: ['switch.update', 'dual_control.update'],
  授权查看: ['feedback.authorize_view', 'feedback.authorize_revoke'],
  处置举报: ['feedback.triage', 'feedback.handle'],
  审计导出: ['audit.export_request', 'audit.export_approve', 'audit.export'],
}
/** 对象类型中文选项 → 真实 target 前缀（target 形如 content_item:<id>） */
const TARGET_MAP: Record<string, string[]> = {
  内容: ['content_item'],
  分析: ['analysis_task'],
  开关: ['feature_switch'],
  举报: ['feedback'],
  成员: ['admin_user'],
  证据: ['evidence_doc'],
}
const TIME_OPTIONS = [
  { label: '近 7 天', value: '168' },
  { label: '近 24 小时', value: '24' },
  { label: '近 30 天', value: '720' },
]

onMounted(async () => {
  await Promise.all([load(), verifyChain(), loadActors(), loadApprovals()])
})

async function loadActors() {
  try {
    const users = await request<{ name: string }[]>({ url: '/admin/users' })
    actorOptions.value = users.map((u) => u.name)
  } catch {
    actorOptions.value = []
  }
}

async function load() {
  loading.value = true
  try {
    const res = await request<AuditList>({
      url: '/admin/audit',
      data: {
        page: page.value,
        page_size: pageSize.value,
        action: filters.value.action === '全部' ? undefined : (ACTION_MAP[filters.value.action] ?? [filters.value.action]).join(','),
        target_type: filters.value.target_type === '全部' ? undefined : (TARGET_MAP[filters.value.target_type] ?? [filters.value.target_type]).join(','),
        role: filters.value.role === '全部' ? undefined : filters.value.role,
        actor: filters.value.actor === '全部' || filters.value.actor === '系统' ? undefined : filters.value.actor,
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

// 导出原因弹层：用站内弹层替代原生 prompt()（原生弹窗对 DOM 自动化不可见，导致首次点击像「无反应」；第十轮）
const showExport = ref(false)
const exportReason = ref('')

/** 打开导出原因弹层（合规支持可申请；只有超级管理员能审批） */
async function onRequestExport() {
  exportReason.value = ''
  showExport.value = true
}

/** 提交导出申请（弹层内提交，写入原因到审计） */
async function submitExport() {
  if (!exportReason.value.trim()) {
    notify('请填写导出原因')
    return
  }
  exporting.value = true
  try {
    await request({
      url: '/admin/audit/export-request',
      method: 'POST',
      data: { reason: exportReason.value.trim() },
    })
    notify('导出申请已提交，需超级管理员审批')
    showExport.value = false
    await loadApprovals()
  } catch (e) {
    notify(e instanceof Error ? e.message : '提交失败')
  } finally {
    exporting.value = false
  }
}

/** 审批导出申请（仅超级管理员） */
async function onApproveExport(id: string) {
  approving.value = id
  try {
    await request({
      url: '/admin/audit/export-approve',
      method: 'POST',
      data: { request_id: id },
    })
    notify('已审批，导出申请生效，可以下载导出文件')
    await loadApprovals()
  } catch (e) {
    notify(e instanceof Error ? e.message : '审批失败')
  } finally {
    approving.value = ''
  }
}

/** 下载导出文件（仅已审批的申请可下载；服务端返回 JSON 文件） */
async function onDownloadExport(id: string) {
  const res = await fetch(`${getBaseUrl()}/admin/audit/export?request_id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${getAdminToken()}` },
  })
  if (!res.ok) {
    // 直接显示服务端的中文原因（已下载过一次 / 只能申请人本人下载 / 尚未通过审批）
    let message = '下载失败，请稍后重试'
    try {
      const body = (await res.json()) as { message?: string }
      if (body?.message) message = body.message
    } catch {
      // 保留默认文案
    }
    notify(message)
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `yaoyouju-audit-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  notify('导出文件已开始下载')
}

/** 导出申请列表 */
const approvals = ref<{ id: string; status: string; applicant_id?: string | null; applicant_name: string | null; approver_name: string | null; reason: string; created_at: string }[]>([])
const exporting = ref(false)
const approving = ref('')

async function loadApprovals() {
  try {
    const res = await request<{ items: { id: string; status: string; applicant_name: string | null; approver_name: string | null; reason: string; created_at: string }[] }>({
      url: '/admin/audit/export-requests',
    })
    approvals.value = res.items
  } catch {
    approvals.value = []
  }
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
            <option v-for="a in actorOptions" :key="a" :value="a">{{ a }}</option>
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
            <option>超级管理</option>
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
        <AppButton type="primary" size="sm" :disabled="exporting" @click="onRequestExport">申请导出（需超管审批）</AppButton>
      </div>
    </AppCard>

    <!-- 导出申请与审批 -->
    <AppCard class="panel">
      <div class="panel__head">
        <h2 class="panel__title">审计导出申请与审批</h2>
        <span class="panel__legend">合规支持可申请 · 仅超级管理员可审批 · 本人不能审批本人</span>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>申请人</th>
            <th>原因</th>
            <th>提交时间</th>
            <th>状态</th>
            <th>审批人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in approvals" :key="a.id">
            <td>{{ a.applicant_name ?? '—' }}</td>
            <td class="table__mail">{{ a.reason }}</td>
            <td>{{ a.created_at.slice(0, 16).replace('T', ' ') }}</td>
            <td>
              <StatusTag v-if="a.status === '已批准'" status="confirmed" text="已批准" />
              <StatusTag v-else-if="a.status === '已导出'" status="offline" text="已导出" />
              <StatusTag v-else status="unconfirmed" text="待审批" />
            </td>
            <td>{{ a.approver_name ?? '—' }}</td>
            <td class="table__ops">
              <button
                v-if="a.status === '待审批' && canApprove"
                type="button"
                class="op-link"
                :disabled="approving === a.id"
                @click="onApproveExport(a.id)"
              >
                审批
              </button>
              <button
                v-else-if="a.status === '已批准' && isApplicant(a)"
                type="button"
                class="op-link"
                @click="onDownloadExport(a.id)"
              >
                下载导出文件
              </button>
              <span v-else-if="a.status === '已导出'" class="table__muted">已下载过一次，不能重复下载</span>
              <span v-else-if="a.status === '已批准'" class="table__muted">需由申请人本人下载</span>
              <span v-else class="table__muted">待超级管理员审批</span>
            </td>
          </tr>
          <tr v-if="approvals.length === 0">
            <td colspan="6" class="table__empty">还没有导出申请</td>
          </tr>
        </tbody>
      </table>
      <p class="panel__note">
        审批通过后可在此下载导出文件（JSON，含哈希），导出行为本身也写入审计；审计日志只追加，不可修改或删除。
      </p>
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
        <span class="panel__total">
          共 {{ total.toLocaleString() }} 条 · 每页 {{ pageSize }} 条 · 演示实现：审计保存在本地 SQLite（只追加 + 哈希链），导出需审批
        </span>
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

    <!-- 导出原因弹层（站内弹层，DOM 可见，可被自动化驱动；替代原生 prompt） -->
    <div v-if="showExport" class="modal-overlay" @click.self="showExport = false">
      <AppCard class="audit-export-modal">
        <h3 class="audit-export-modal__title">申请导出审计日志</h3>
        <p class="audit-export-modal__hint">导出原因将写入审计；提交后需超级管理员审批，审批通过后由申请人本人下载。</p>
        <textarea
          v-model="exportReason"
          class="audit-export-modal__input"
          rows="3"
          placeholder="请填写导出原因（必填）"
        ></textarea>
        <div class="audit-export-modal__actions">
          <AppButton type="soft" @click="showExport = false">取消</AppButton>
          <AppButton type="primary" :disabled="exporting" data-testid="submit-export" @click="submitExport">
            {{ exporting ? '提交中…' : '提交申请' }}
          </AppButton>
        </div>
      </AppCard>
    </div>
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

.table__muted {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
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
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.audit-export-modal {
  width: 440px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.audit-export-modal__title {
  margin: 0;
  font-size: 16px;
  color: var(--color-text-1, #1a1a1a);
}
.audit-export-modal__hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-3, #888);
  line-height: 1.6;
}
.audit-export-modal__input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border, #e2e2e2);
  border-radius: var(--radius-tag, 8px);
  padding: 8px 10px;
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
}
.audit-export-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

</style>
