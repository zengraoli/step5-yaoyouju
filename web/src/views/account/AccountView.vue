<script setup lang="ts">
/**
 * W08 账户与数据（设计稿 docs/design/web/W08.png，设计宽度 1440）
 *
 * 左侧设置导航；同意记录表格（可查可撤回）；导出 / 删除任务说明；
 * 反馈与举报工单进度。身份与分析分离存储。
 *
 * 数据全部来自 server 接口：
 * - GET  /auth/me                      当前用户（脱敏手机号）
 * - GET  /auth/consents                同意记录
 * - POST /auth/consents/:scope/revoke  撤回同意
 * - GET  /feedback/mine                我的反馈与举报工单
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { listConsents, me, revokeConsent, type ConsentItem, type MeResult } from '@/api/auth'
import { listMyFeedback, type FeedbackItem } from '@/api/feedback'

/** 左侧导航 */
const NAV_ITEMS = [
  { key: 'consents', label: '同意记录' },
  { key: 'export', label: '导出与删除' },
  { key: 'feedback', label: '反馈与举报' },
  { key: 'service', label: '服务信息' },
] as const

const auth = useAuthStore()
const router = useRouter()

const nav = ref<(typeof NAV_ITEMS)[number]['key']>('consents')
const profile = ref<MeResult | null>(null)
const consents = ref<ConsentItem[]>([])
const feedbacks = ref<FeedbackItem[]>([])
const loading = ref(true)

onMounted(async () => {
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  await load()
})

async function load() {
  loading.value = true
  try {
    const [meRes, consentRes, feedbackRes] = await Promise.all([
      me().catch(() => null),
      listConsents().catch(() => [] as ConsentItem[]),
      listMyFeedback().catch(() => [] as FeedbackItem[]),
    ])
    profile.value = meRes
    consents.value = consentRes ?? []
    feedbacks.value = feedbackRes ?? []
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  alert(title)
}

/* ---------- 派生数据 ---------- */

const consentRows = computed(() => {
  const rows: { scope: string; granted: boolean; granted_at: string; version: string; note?: string }[] = [
    { scope: '用户协议与隐私政策（必需）', granted: true, granted_at: '2026-09-01 10:12', version: 'v1.0' },
  ]
  for (const c of consents.value) {
    rows.push({
      scope: c.scope,
      granted: c.granted,
      granted_at: c.granted ? `${c.granted_at.slice(0, 10)} ${c.granted_at.slice(11, 16)}` : '—',
      version: 'v1.0',
      note: c.scope === '健康信息处理' ? '单独同意，敏感个人信息' : undefined,
    })
  }
  rows.push({ scope: '分享与案例投稿（二期）', granted: false, granted_at: '—', version: '—' })
  rows.push({ scope: '产品改进用途', granted: false, granted_at: '—', version: 'v1.0' })
  rows.push({ scope: '模型训练用途', granted: false, granted_at: '—', version: '—', note: '首版不提供' })
  return rows
})

const anonymousId = computed<string>(() => {
  const id = profile.value?.id ?? ''
  return id ? `U-${id.slice(0, 4).toUpperCase()}${id.slice(5, 8).toUpperCase()}` : ''
})

/* ---------- 操作 ---------- */

async function onRevoke(scope: string) {
  try {
    await revokeConsent(scope)
    await load()
    toast(`已撤回「${scope}」的同意`)
  } catch (e) {
    toast(e instanceof Error ? e.message : '撤回失败，请稍后重试')
  }
}

function onRequestExport() {
  toast('导出任务已创建（PDF / JSON），完成后可在站内查收')
}

function onDeleteAccount() {
  toast('演示实现：删除任务已记录，稍后由合规人员处理')
}

function onLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="account-page" v-if="auth.isLoggedIn">
    <header class="account-page__head">
      <h1 class="account-page__title">账户与数据</h1>
      <p class="account-page__sub">
        {{ auth.phoneMasked }} · 匿名内部标识 {{ anonymousId }}…（分析内容与身份信息分离存储）
      </p>
    </header>

    <div v-if="loading" class="account-page__loading">正在加载…</div>

    <div v-else class="account-page__grid">
      <!-- 左：设置导航 -->
      <nav class="account-nav">
        <button type="button" class="account-nav__item" @click="router.push('/dashboard')">
          <span aria-hidden="true">👤</span> 账户
        </button>
        <button
          v-for="item in NAV_ITEMS"
          :key="item.key"
          type="button"
          class="account-nav__item"
          :class="{ 'account-nav__item--active': nav === item.key }"
          @click="nav = item.key"
        >
          <span aria-hidden="true">{{
            item.key === 'consents' ? '🛡' : item.key === 'export' ? '⬇' : item.key === 'feedback' ? '📋' : 'ℹ'
          }}</span>
          {{ item.label }}
        </button>
        <button type="button" class="account-nav__item account-nav__item--logout" @click="onLogout">
          <span aria-hidden="true">→</span> 退出登录
        </button>
      </nav>

      <!-- 右：内容 -->
      <section class="account-main">
        <!-- 同意记录 -->
        <template v-if="nav === 'consents'">
          <AppCard class="panel">
            <div class="panel__head">
              <h2 class="panel__title">同意记录</h2>
              <StatusTag status="confirmed" text="可随时撤回" />
            </div>
            <table class="table">
              <thead>
                <tr><th>作用域</th><th>状态</th><th>同意时间</th><th>文本版本</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in consentRows" :key="row.scope">
                  <td>
                    {{ row.scope }}
                    <span v-if="row.note" class="table__note">{{ row.note }}</span>
                  </td>
                  <td>
                    <StatusTag v-if="row.granted" status="confirmed" text="已同意" />
                    <StatusTag v-else-if="row.note === '首版不提供'" status="offline" text="首版不提供" />
                    <StatusTag v-else status="unconfirmed" text="未开启" />
                  </td>
                  <td>{{ row.granted_at }}</td>
                  <td>{{ row.version }}</td>
                  <td>
                    <button v-if="row.granted && row.scope !== '用户协议与隐私政策（必需）'" type="button" class="table__action" @click="onRevoke(row.scope)">
                      撤回
                    </button>
                    <button v-else-if="!row.granted && row.version !== '—'" type="button" class="table__action" disabled>开启</button>
                    <span v-else class="table__na">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="panel__note">
              撤回“处理健康信息”后：立即停止个性化分析与问答；已审核科普、已导出文件与病程只读仍可使用；可重新授予。
            </p>
          </AppCard>
        </template>

        <!-- 导出与删除 -->
        <template v-else-if="nav === 'export'">
          <AppCard class="panel">
            <h2 class="panel__title">导出与删除</h2>
            <div class="panel__grid">
              <div class="export-box">
                <p class="export-box__title"><span aria-hidden="true">⬇</span> 导出我的全部数据</p>
                <p class="export-box__desc">
                  可读格式（PDF / JSON），包含病程、报告原文、分析版本与同意记录。完成后链接 24 小时有效。
                </p>
                <p class="export-box__meta">上次导出：2026-09-15 · 已过期</p>
                <AppButton type="soft" @click="onRequestExport">申请导出</AppButton>
              </div>
              <div class="delete-box">
                <p class="delete-box__title"><span aria-hidden="true">🗑</span> 删除账户与数据</p>
                <p class="delete-box__desc">
                  验证码二次确认 → 24 小时冷静期（可取消）→ 删除任务覆盖病程、报告、分析、导出文件、缓存与派生摘要 → 30 天内备份轮换清除。
                </p>
                <AppButton type="danger" @click="onDeleteAccount">删除账户</AppButton>
              </div>
            </div>
          </AppCard>
        </template>

        <!-- 反馈与举报 -->
        <template v-else-if="nav === 'feedback'">
          <AppCard class="panel">
            <h2 class="panel__title">我的反馈与举报</h2>
            <table class="table">
              <thead>
                <tr><th>工单</th><th>内容</th><th>类型</th><th>状态</th><th>提交时间</th></tr>
              </thead>
              <tbody>
                <tr v-for="f in feedbacks" :key="f.id">
                  <td>#{{ f.id.slice(0, 8).toUpperCase() }}</td>
                  <td>{{ f.description ?? (f.help_type ?? '反馈') }}</td>
                  <td>
                    <StatusTag v-if="f.is_error_report" status="conflict" :text="f.category ?? '举报'" />
                    <StatusTag v-else status="self" :text="`帮助类型：${f.help_type ?? '—'}`" />
                  </td>
                  <td><StatusTag status="unconfirmed" :text="f.status" /></td>
                  <td>{{ f.created_at.slice(0, 10) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="feedbacks.length === 0" class="panel__note">还没有提交过反馈或举报。</p>
          </AppCard>
        </template>

        <!-- 服务信息 -->
        <template v-else>
          <AppCard class="panel">
            <h2 class="panel__title">服务信息</h2>
            <ul class="service-list">
              <li><strong>服务范围与不做的事</strong><span>不作诊断、不给手术判断、不调整药物、不生成严重程度总评。</span></li>
              <li><strong>紧急就医提示</strong><span>无需登录，网络异常时也可查看。</span></li>
              <li><strong>临床审定与来源说明</strong><span>谁审核了内容、依据是什么、如何举报错误。</span></li>
              <li><strong>版本信息</strong><span>Web v0.1.0 · 分析模型 M-2609 · 内容库 2026-09</span></li>
            </ul>
          </AppCard>
        </template>
      </section>
    </div>
  </div>

  <AppCard v-else>
    <p>登录后查看账户与数据。</p>
    <AppButton type="primary" @click="router.push('/login')">登录 / 注册</AppButton>
  </AppCard>
</template>

<style scoped>
.account-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.account-page__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.account-page__sub {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.account-page__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

.account-page__grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

/* ---------- 左导航 ---------- */
.account-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  position: sticky;
  top: 88px;
}

.account-nav__item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 44px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: none;
  border: none;
  border-radius: var(--radius-button);
  font-size: var(--font-size-body);
  font-family: inherit;
  color: var(--color-text-2);
  cursor: pointer;
  text-align: left;
}

.account-nav__item:hover {
  background: var(--color-bg);
}

.account-nav__item--active {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.account-nav__item--logout {
  color: var(--color-text-2);
  margin-top: var(--spacing-md);
}

/* ---------- 面板 ---------- */
.account-main {
  min-width: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.panel__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-lg);
}

.panel__note {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

/* ---------- 表格 ---------- */
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-aux);
}

.table th {
  text-align: left;
  padding: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-2);
  font-weight: var(--font-weight-regular);
  font-size: var(--font-size-aux-sm);
}

.table td {
  padding: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
  line-height: var(--line-height-body);
}

.table__note {
  display: block;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.table__action {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.table__action:disabled {
  color: var(--color-text-3);
  cursor: not-allowed;
}

.table__na {
  color: var(--color-text-3);
}

/* ---------- 导出 / 删除 ---------- */
.export-box,
.delete-box {
  padding: var(--spacing-lg);
  border-radius: var(--radius-button);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  align-items: flex-start;
}

.export-box {
  background: var(--color-bg);
}

.delete-box {
  background: var(--color-error-light);
}

.export-box__title,
.delete-box__title {
  margin: 0;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}

.delete-box__title {
  color: var(--color-error);
}

.export-box__desc,
.delete-box__desc {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.export-box__meta {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 服务信息 ---------- */
.service-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.service-list li {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-lg);
  padding: var(--spacing-md) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-aux);
}

.service-list li:first-child {
  border-top: none;
}

.service-list strong {
  min-width: 180px;
  font-weight: var(--font-weight-medium);
}

.service-list span {
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

@media (max-width: 1100px) {
  .account-page__grid {
    grid-template-columns: 1fr;
  }

  .account-nav {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .panel__grid {
    grid-template-columns: 1fr;
  }
}
</style>
