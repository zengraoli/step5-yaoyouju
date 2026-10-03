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
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { request } from '@/api/request'
import DualConfirm from '@/components/DualConfirm.vue'

/** 邀请成员弹层 */
const showInvite = ref(false)
const inviteForm = ref({ name: '', role: '运营编辑', password: '' })
const inviting = ref(false)
/** 当前是否只有一名超级管理员（引导式新增第二名超管） */
const onlyOneSuper = computed<boolean>(
  () => users.value.filter((u) => u.role === '超级管理员' && u.status === '正常').length <= 1,
)
/** 改变角色弹层 */
const showRole = ref(false)
const roleUser = ref<AdminUser | null>(null)
const roleForm = ref({ role: '运营编辑' })

/** 停用超级管理员的双人确认 */
const dualUser = ref<AdminUser | null>(null)
const dualRef = ref<{ start: (target?: unknown, label?: string) => void } | null>(null)
/** 邀请超级管理员 / 改变角色的双人确认 */
const dualInviteRef = ref<{ start: (target?: unknown, label?: string) => void } | null>(null)
const roleDualRef = ref<{ start: (target?: unknown, label?: string) => void } | null>(null)

/** 双人确认后停用成员 */
async function submitUserDual(confirmationId: string): Promise<unknown> {
  const u = dualUser.value
  if (!u) throw new Error('未选择成员')
  const result = await request({
    url: `/admin/users/${u.id}/status`,
    method: 'POST',
    data: { active: false, reason: '双人确认后停用', confirmation_id: confirmationId },
  })
  notify('已按双人确认结果停用（写入审计）')
  await load()
  return result
}

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
  expires_at?: string | null
  /** 关联的举报 ID（撤回授权用） */
  feedback_id?: string
  /** 申请人 / 审批人 */
  requested_by?: string
  approved_by?: string
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
const panelError = ref('')

const isSuper = computed<boolean>(() => auth.role === '超级管理员' || auth.hasPermission('*'))

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  panelError.value = ''
  // 逐个接口独立容错：某个面板没有权限时只显示该面板的说明，不阻塞其他面板
  const settle = async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn()
    } catch (e) {
      panelError.value = e instanceof Error ? e.message : '部分数据加载失败'
      return fallback
    }
  }
  const [u, r, a, d] = await Promise.all([
    settle(() => request<AdminUser[]>({ url: '/admin/users' }), [] as AdminUser[]),
    settle(() => request<{ roles: RoleItem[] } | RoleItem[]>({ url: '/admin/roles' }), [] as RoleItem[]),
    settle(
      () => request<Authorization[] | { items: Authorization[] }>({ url: '/admin/authorizations' }),
      [] as Authorization[],
    ),
    settle(() => request<DualControlSettings>({ url: '/admin/dual-control/settings' }), null),
  ])
  users.value = Array.isArray(u) ? u : []
  roles.value = Array.isArray(r) ? r : (r?.roles ?? [])
  authorizations.value = Array.isArray(a) ? a : (a?.items ?? [])
  dualControl.value = d
  loading.value = false
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
  { key: 'content.publish', label: '内容：发布（双人）', partial: 'content.submit' },  // 运营编辑只能发起
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
  { key: 'eval.manage', label: '评测集 / 评测运行', partial: 'eval.view' },
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
  // 停用超级管理员必须双人确认：不能一个人停用另一名超级管理员（也不能停用自己）
  if (!next && (user.role === '超级管理员' || user.name === auth.admin?.name)) {
    dualUser.value = user
    dualRef.value?.start(false, `停用 ${user.name}`)
    return
  }
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

/** 撤回单条授权（立即生效，写审计） */
async function onRevokeAuthorization(a: Authorization) {
  if (!confirmAction(`确认撤回「${a.target}」的单条授权？撤回后立即不可查看原文。`)) return
  operating.value = a.id
  try {
    const targetId = a.feedback_id ?? a.id
    await request({ url: `/admin/feedback/${encodeURIComponent(targetId)}/revoke-view`, method: 'POST' })
    notify('已撤回单条授权（写入审计）')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '撤回失败，请稍后重试')
  } finally {
    operating.value = ''
  }
}

function onInvite() {
  showInvite.value = true
}

/** 邀请成员（无自助注册；首次登录需绑定 MFA） */
async function submitInvite() {
  const name = inviteForm.value.name.trim()
  const password = inviteForm.value.password
  if (!name || !password) {
    notify('请填写账号与初始口令')
    return
  }
  if (password.length < 8) {
    notify('初始口令至少 8 位')
    return
  }
  inviting.value = true
  try {
    await request({
      url: '/admin/users',
      method: 'POST',
      data: { name, role: inviteForm.value.role, password },
    })
    // 只有一名超级管理员时服务端走引导分支：直接新增（写审计），不需要第二人确认
    notify(
      inviteForm.value.role === '超级管理员' && onlyOneSuper.value
        ? '已引导式新增第二名超级管理员（写入审计）；之后再邀请超级管理员必须双人确认'
        : '已邀请成员；首次登录需绑定 MFA 后才能操作',
    )
    showInvite.value = false
    inviteForm.value = { name: '', role: '运营编辑', password: '' }
    await load()
  } catch (e) {
    // 邀请超级管理员需要双人确认：40900 时带上确认单 ID 由另一名账号确认
    const err = e as { message?: string; data?: { confirmation_id?: string } }
    if (inviteForm.value.role === '超级管理员' && err?.data?.confirmation_id) {
      notify('已提交「邀请超级管理员」双人确认申请：请由另一名超级管理员在「待我确认」里确认')
      showInvite.value = false
      await load()
      return
    }
    notify(e instanceof Error ? e.message : '邀请失败')
  } finally {
    inviting.value = false
  }
}

/** 打开「改变角色」弹层（超级管理员；需另一名超级管理员双人确认） */
function onChangeRole(user: AdminUser) {
  if (!isSuper.value) {
    notify('改变角色需要超级管理员权限')
    return
  }
  if (user.name === auth.admin?.name) {
    notify('不能变更自己的角色，请换一位超级管理员操作')
    return
  }
  roleUser.value = user
  roleForm.value = { role: user.role }
  showRole.value = true
}

/** 带确认单 ID 再次提交邀请超级管理员（第二人确认后生效） */
async function submitInviteSuperDual(confirmationId: string): Promise<unknown> {
  const result = await request({
    url: '/admin/users',
    method: 'POST',
    data: {
      name: inviteForm.value.name.trim(),
      role: '超级管理员',
      password: inviteForm.value.password,
      confirmation_id: confirmationId,
    },
  })
  notify('已按双人确认结果邀请超级管理员（写入审计）')
  showInvite.value = false
  inviteForm.value = { name: '', role: '运营编辑', password: '' }
  await load()
  return result
}

/** 改变角色（双人确认后生效） */
async function submitRoleDual(confirmationId: string): Promise<unknown> {
  const u = roleUser.value
  if (!u) throw new Error('未选择成员')
  const result = await request({
    url: `/admin/users/${u.id}/role`,
    method: 'POST',
    data: { role: roleForm.value.role, confirmation_id: confirmationId },
  })
  notify('已按双人确认结果变更角色（写入审计）')
  showRole.value = false
  await load()
  return result
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
      <AppNotice v-else-if="panelError && users.length === 0" type="warn">
        {{ panelError }}（当前角色可能没有查看权限）
      </AppNotice>
      <table v-else-if="users.length > 0" class="table">
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
            <td>{{ u.last_login ? String(u.last_login).slice(0, 16).replace('T', ' ') : '—' }}</td>
            <td>
              <StatusTag v-if="u.status === '正常'" status="confirmed" text="正常" />
              <StatusTag v-else status="offline" text="已停用" />
            </td>
            <td class="table__ops">
              <button type="button" class="op-link" @click="onChangeRole(u)">改变角色</button>
              <button type="button" class="op-link" @click="onResetMfa(u)">重置 MFA</button>
              <button type="button" class="op-link" :disabled="operating === u.id" @click="onToggleStatus(u)">
                {{ u.status === '正常' ? '停用' : '启用' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="panel__note">暂无可显示的成员（当前角色可能没有查看权限）。</p>
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
                <StatusTag v-if="a.status === '过期'" status="offline" text="已过期" />
                <StatusTag v-else-if="a.status === '已撤回'" status="offline" text="已撤回" />
                <StatusTag v-else status="confirmed" text="有效" />
              </div>
              <p class="auth-item__target">{{ a.target }}</p>
              <p class="auth-item__meta">
                {{ a.created_at.slice(0, 10) }} 起 · 范围：{{ a.scope || '本条举报的用户原始内容' }}
                <template v-if="a.expires_at"> · 有效至 {{ String(a.expires_at).slice(0, 10) }}</template>
              </p>
              <div class="auth-item__ops">
                <button
                  type="button"
                  class="op-link"
                  :disabled="a.status !== '有效'"
                  @click="onRevokeAuthorization(a)"
                >
                  撤回授权
                </button>
              </div>
            </li>
            <li v-if="authorizations.length === 0" class="auth-item">还没有单条授权记录</li>
          </ul>
          <p class="panel__note">
            授权由临床审核申请、超级管理员审批后生效（7 天有效）；每次读取原文都写审计；
            可在此撤回，用户也可在「我的 → 数据与授权」里撤回自己的授权。
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

    <!-- 邀请成员弹层 -->
    <div v-if="showInvite" class="modal-mask" @click.self="showInvite = false">
      <AppCard class="modal">
        <h3 class="modal__title">邀请成员</h3>
        <p class="modal__desc">无自助注册。新成员首次登录需绑定 MFA（演示码 123456）后才能操作。</p>
        <label class="modal__field">
          <span>账号（工作邮箱）</span>
          <input v-model="inviteForm.name" class="modal__input" type="text" maxlength="100" placeholder="例如：editor02" />
        </label>
        <label class="modal__field">
          <span>角色</span>
          <select v-model="inviteForm.role" class="modal__input">
            <option value="运营编辑">运营编辑</option>
            <option value="临床审核">临床审核</option>
            <option value="技术负责人">技术负责人</option>
            <option value="合规支持">合规支持</option>
            <option value="超级管理员">超级管理员</option>
          </select>
        </label>
        <label class="modal__field">
          <span>初始口令（至少 8 位，仅传输与哈希）</span>
          <input v-model="inviteForm.password" class="modal__input" type="password" maxlength="100" />
        </label>
        <div class="modal__actions">
          <AppButton type="primary" :disabled="inviting" @click="submitInvite">
            {{ inviting ? '提交中…' : '邀请' }}
          </AppButton>
          <AppButton type="soft" @click="showInvite = false">取消</AppButton>
        </div>
      </AppCard>
    </div>

    <!-- 改变角色弹层（超级管理员；另一名超级管理员双人确认后生效） -->
    <div v-if="showRole" class="modal-mask" @click.self="showRole = false">
      <AppCard class="modal">
        <h3 class="modal__title">改变角色 · {{ roleUser?.name }}</h3>
        <p class="modal__desc">
          变更角色属于高风险操作，需要另一名超级管理员双人确认后生效；变更后该账号需重新登录。
        </p>
        <label class="modal__field">
          <span>新角色</span>
          <select v-model="roleForm.role" class="modal__input">
            <option value="运营编辑">运营编辑</option>
            <option value="临床审核">临床审核</option>
            <option value="技术负责人">技术负责人</option>
            <option value="合规支持">合规支持</option>
            <option value="超级管理员">超级管理员</option>
          </select>
        </label>
        <div class="modal__actions">
          <AppButton type="primary" @click="roleDualRef?.start(roleForm.role, `变更 ${roleUser?.name ?? ''} 的角色为 ${roleForm.role}`)">
            发起双人确认
          </AppButton>
          <AppButton type="soft" @click="showRole = false">取消</AppButton>
        </div>
      </AppCard>
    </div>

    <!-- 停用成员双人确认弹层（按钮隐藏：由成员行的停用操作触发） -->
    <DualConfirm
      :ref="(el) => (dualRef = el as never)"
      action="user.status"
      :target-id="dualUser?.id ?? ''"
      :target-label="`停用 ${dualUser?.name ?? ''}（需另一名超级管理员确认）`"
      :payload="{ active: false, reason: '双人确认后停用' }"
      :submit="submitUserDual"
      :show-button="false"
      @done="load()"
    />

    <!-- 邀请超级管理员双人确认弹层（已有两名及以上超级管理员时必须双人确认） -->
    <DualConfirm
      :ref="(el) => (dualInviteRef = el as never)"
      action="user.invite_super"
      :target-id="inviteForm.name.trim()"
      :target-label="`邀请超级管理员「${inviteForm.name.trim()}」`"
      :payload="{ name: inviteForm.name.trim(), role: '超级管理员', password: inviteForm.password }"
      :submit="submitInviteSuperDual"
      :show-button="false"
      @done="load()"
    />

    <!-- 改变角色双人确认弹层 -->
    <DualConfirm
      :ref="(el) => (roleDualRef = el as never)"
      action="user.role"
      :target-id="roleUser?.id ?? ''"
      :target-label="`变更 ${roleUser?.name ?? ''} 的角色：${roleUser?.role ?? ''} → ${roleForm.role}`"
      :payload="{ role: roleForm.role }"
      :submit="submitRoleDual"
      :show-button="false"
      @done="load()"
    />
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgb(27 34 48 / 45%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-lg);
  z-index: 40;
}
.modal {
  width: 100%;
  max-width: 480px;
}
.modal__title {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-card-title);
}
.modal__desc {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}
.modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}
.modal__input {
  height: 36px;
  padding: 0 var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-size: var(--font-size-body);
}
.modal__actions {
  display: flex;
  gap: var(--spacing-sm);
}
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
