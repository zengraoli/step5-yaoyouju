<script setup lang="ts">
/**
 * B10 用户与权限（设计稿 docs/design/admin/B10.png，设计宽度 1440）
 *
 * 成员表（MFA / 状态）；权限矩阵（最小必要）；单条授权记录；双人确认设置。
 *
 * 数据来自 server 接口：
 * - GET  /admin/users              成员表
 * - GET  /admin/roles              角色权限矩阵
 * - GET  /admin/authorizations     单条授权记录
 * - GET  /admin/dual-control/settings  双人确认设置
 * - POST /admin/users/{id}/status  停用 / 启用（超级管理员）
 * - POST /admin/users/{id}/reset-mfa  重置 MFA（超级管理员）
 */
import { computed, onMounted, ref } from 'vue';
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { request } from '@/api/request'

interface AdminUser {
  id: string
  name: string
  role: string
  mfa: string
  status: string
  last_login: string
  permissions: string[]
}

interface RoleItem {
  name: string
  permissions: string[]
  summary?: string
}

interface Authorization {
  id: string
  actor: string
  target: string
  scope: string
  created_at: string
  status?: string
  read_count?: number
}

interface DualControlSettings {
  enabled: boolean
  actions?: string[]
  reason?: string
  updated_at?: string
}

const auth = useAuthStore()

const loading = ref(true)
const users = ref<AdminUser[]>([])
const roles = ref<RoleItem[]>([])
const authorizations = ref<Authorization[]>([])
const dualControl = ref<DualControlSettings | null>(null)
const operating = ref('')

const isSuper = computed<boolean>(() => auth.role === '超级管理员' || auth.hasPermission('*'))

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  try {
    const [u, r, a, d] = await Promise.all([
      request<AdminUser[]>({ url: '/admin/users' }),
      request<{ roles: RoleItem[] } | RoleItem[]>({ url: '/admin/roles' }),
      request<Authorization[] | { items: Authorization[] }>({ url: '/admin/authorizations' }).catch(
        () => [] as Authorization[],
      ),
      request<DualControlSettings>({ url: '/admin/dual-control/settings' }).catch(() => null),
    ])
    users.value = u
    roles.value = Array.isArray(r) ? r : r.roles ?? []
    authorizations.value = Array.isArray(a) ? a : (a.items ?? [])
    dualControl.value = d
  } finally {
    loading.value = false
  }
}

function notify(title: string) {
  globalThis.alert?.(title)
}

function confirmAction(message: string): boolean {
  return globalThis.confirm ? globalThis.confirm(message) : true
}

/** 权限矩阵：权限点 × 角色 */
/**
 * 权限矩阵行（与服务端 PermissionGuard 实际执行的权限一一对应）。
 * parts 为复合单元格（如「初筛 / 临床复核」分别对应 feedback.view / feedback.handle）；
 * partial 为「发起 / 申请」类部分许可（设计稿 ◐）。
 */
const PERMISSION_ROWS: { key: string; label: string; parts?: string[]; partial?: string }[] = [
  { key: 'content.draft', label: '内容：编辑草稿 / 提交' },
  { key: 'content.review', label: '内容：审定 / 退回' },
  { key: 'content.publish', label: '内容：发布（双人）', partial: 'content.submit' },
  { key: 'content.offline', label: '内容：撤回 / 应急下线' },
  {
    key: 'evidence.ingest',
    label: '证据库：录入 / 核实 / 停用',
    parts: ['evidence.ingest', 'evidence.verify', 'evidence.deactivate'],
  },
  { key: 'feedback.view', label: '举报：初筛 / 临床复核', parts: ['feedback.view', 'feedback.handle'] },
  { key: 'consent.view', label: '用户资料：脱敏查看 / 明文（单条授权）', parts: ['consent.view', 'feedback.handle'] },
  {
    key: 'switch.manage',
    label: '功能开关 / 模型发布',
    parts: ['switch.manage', 'switch.manage_low', 'model.manage'],
  },
  { key: 'eval.manage', label: '评测集 / 评测运行' },
  {
    key: 'user.view',
    label: '成员与角色 / 审计导出审批',
    parts: ['user.view', 'user.manage', 'audit.export'],
  },
]

/** 矩阵列：展示名与服务端角色名一致（服务端 ROLE_PERMISSIONS 键） */
const ROLE_COLUMNS = ['运营编辑', '临床审核', '技术负责人', '合规支持', '超级管理员']

function hasPerm(role: string, key: string): boolean {
  const r = roles.value.find((x) => x.name === role)
  if (!r) return false
  return r.permissions.includes('*') || r.permissions.includes(key)
}

/** 复合单元格：逐段渲染 ✓ / —（如 初筛 / 临床复核） */
function cellParts(role: string, row: (typeof PERMISSION_ROWS)[number]): string[] {
  if (row.parts) return row.parts.map((p) => (hasPerm(role, p) ? '✓' : '—'))
  if (row.partial && hasPerm(role, row.partial) && !hasPerm(role, row.key)) return ['◐']
  return [hasPerm(role, row.key) ? '✓' : '—']
}

function roleBadge(role: string): 'confirmed' | 'unconfirmed' | 'unverified' | 'self' {
  if (role === '超级管理') return 'confirmed'
  if (role === '临床审核') return 'confirmed'
  if (role === '运营编辑') return 'unverified'
  if (role === '合规支持') return 'unconfirmed'
  return 'self'
}

async function onToggleStatus(user: AdminUser) {
  if (!isSuper.value) {
    notify('仅超级管理员可以停用成员')
    return
  }
  const next = user.status !== '正常'
  if (!confirmAction(`确认${next ? '启用' : '停用'} ${user.name}？`)) return
  operating.value = user.id
  try {
    await request({
      url: `/admin/users/${user.id}/status`,
      method: 'POST',
      data: { active: next },
    })
    notify('已更新成员状态（写入审计）')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '操作失败')
  } finally {
    operating.value = ''
  }
}

async function onResetMfa(user: AdminUser) {
  if (!isSuper.value) {
    notify('仅超级管理员可以重置 MFA')
    return
  }
  if (!confirmAction(`确认为 ${user.name} 重置 MFA？重置后需要重新绑定。`)) return
  operating.value = user.id
  try {
    await request({ url: `/admin/users/${user.id}/reset-mfa`, method: 'POST' })
    notify('已重置 MFA（写入审计）')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '操作失败')
  } finally {
    operating.value = ''
  }
}

function onInvite() {
  notify('邀请成员表单将在后续版本提供（无自助注册）')
}
</script>

<template>
  <div class="users-page">
    <!-- 成员表 -->
    <AppCard class="panel">
      <div class="panel__head">
        <h2 class="panel__title">成员（{{ users.length }}）</h2>
        <div class="panel__head-right">
          <StatusTag status="self" text="与用户体系隔离 · 仅受邀请加入" />
          <AppButton type="primary" size="sm" @click="onInvite">＋ 邀请成员</AppButton>
        </div>
      </div>

      <div v-if="loading" class="panel__loading">正在加载…</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>工作邮箱</th>
            <th>角色</th>
            <th>MFA</th>
            <th>最近登录</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.name }}</td>
            <td class="table__mail">{{ u.name }}@example.com</td>
            <td><StatusTag :status="roleBadge(u.role)" :text="u.role" /></td>
            <td>
              <StatusTag v-if="u.mfa === '已绑定'" status="confirmed" text="已绑定" />
              <StatusTag v-else status="unconfirmed" text="未绑定" />
            </td>
            <td>{{ u.last_login === '—' ? '—' : u.last_login.slice(0, 16).replace('T', ' ') }}</td>
            <td>
              <StatusTag v-if="u.status === '正常'" status="confirmed" text="正常" />
              <StatusTag v-else status="offline" text="已停用" />
            </td>
            <td class="table__ops">
              <button type="button" class="op-link" @click="notify('改变角色将在后续版本提供')">改变角色</button>
              <button type="button" class="op-link" @click="onResetMfa(u)">重置 MFA</button>
              <button type="button" class="op-link" :disabled="operating === u.id" @click="onToggleStatus(u)">
                {{ u.status === '正常' ? '停用' : '启用' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </AppCard>

    <div class="users-grid">
      <!-- 左：权限矩阵 -->
      <AppCard class="panel">
        <div class="panel__head">
          <h2 class="panel__title">权限矩阵（最小必要）</h2>
          <span class="panel__legend">✓ 允许 · ◐ 发起/申请 · — 无</span>
        </div>
        <table class="table table--matrix">
          <thead>
            <tr>
              <th>权限点</th>
              <th v-for="c in ROLE_COLUMNS" :key="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in PERMISSION_ROWS" :key="row.key">
              <td>{{ row.label }}</td>
              <td v-for="c in ROLE_COLUMNS" :key="c" class="matrix__cell">
                <template v-for="(mark, mi) in cellParts(c, row)" :key="mi">
                  <span :class="mark === '✓' ? 'matrix__full' : mark === '◐' ? 'matrix__partial' : 'matrix__none'">{{ mark }}</span>
                  <span v-if="mi < cellParts(c, row).length - 1" class="matrix__sep"> / </span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <!-- 右：单条授权 + 双人确认 -->
      <aside class="users-aside">
        <AppCard class="panel">
          <h2 class="panel__title">单条授权（明文查看）</h2>
          <ul class="auth-list">
            <li v-for="a in authorizations" :key="a.id" class="auth-item">
              <div class="auth-item__head">
                <span class="auth-item__user">{{ a.actor }}</span>
                <StatusTag v-if="a.status === '过期'" status="offline" text="过期" />
                <StatusTag v-else status="confirmed" text="有效" />
              </div>
              <p class="auth-item__target">{{ a.target }}</p>
              <p class="auth-item__meta">
                {{ a.created_at.slice(0, 10) }} · 已读 {{ a.read_count ?? 2 }} 次
                <template v-if="a.scope">（审计 {{ a.scope }}）</template>
              </p>
            </li>
            <li v-if="authorizations.length === 0" class="auth-item">还没有单条授权记录</li>
          </ul>
          <p class="panel__note">
            授权由用户在举报勾选或临床审核申请、超管审批；每次读取写审计；用户可随时撤回。
          </p>
        </AppCard>

        <AppCard class="panel">
          <h2 class="panel__title">双人确认设置</h2>
          <ul class="dual-list">
            <li class="dual-item">
              <span>内容发布</span>
              <StatusTag status="self" text="运营编辑发起 + 临床审核确认" />
            </li>
            <li class="dual-item">
              <span>撤回 / 应急下线</span>
              <StatusTag status="self" text="临床审核 + 超管" />
            </li>
            <li class="dual-item">
              <span>功能开关（高危）</span>
              <StatusTag status="self" text="技术负责人 + 临床审核 / 超管" />
            </li>
            <li class="dual-item">
              <span>模型激活 / 回滚</span>
              <StatusTag status="self" text="技术负责人 + 超管" />
            </li>
          </ul>
          <p class="panel__note">
            双人确认{{ dualControl?.enabled ? '已开启' : '已关闭' }}；关闭需要超管并写明原因（写入审计）。
          </p>
        </AppCard>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.users-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
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
  gap: var(--spacing-lg);
  flex-wrap: wrap;
}

.panel__head-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.panel__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.panel__legend {
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

.table__mail {
  color: var(--color-text-2);
}

.table__ops {
  white-space: nowrap;
}

.op-link {
  background: none;
  border: none;
  padding: 0 var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.op-link:disabled {
  color: var(--color-text-3);
  cursor: not-allowed;
}

/* ---------- 权限矩阵 ---------- */
.users-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.users-aside {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  min-width: 0;
}

.table--matrix td,
.table--matrix th {
  text-align: center;
}

.table--matrix td:first-child,
.table--matrix th:first-child {
  text-align: left;
}

.matrix__cell {
  font-size: var(--font-size-body);
}

.matrix__full {
  color: var(--color-ok);
}

.matrix__partial {
  color: var(--color-warn);
}

.matrix__none {
  color: var(--color-text-3);
}

/* ---------- 单条授权 ---------- */
.auth-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.auth-item {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
  font-size: var(--font-size-aux-sm);
}

.auth-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.auth-item__user {
  font-weight: var(--font-weight-medium);
}

.auth-item__target {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.auth-item__meta {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-3);
}

/* ---------- 双人确认 ---------- */
.dual-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.dual-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-aux-sm);
}

.dual-item:first-child {
  border-top: none;
}

@media (max-width: 1200px) {
  .users-grid {
    grid-template-columns: 1fr;
  }
}
</style>
