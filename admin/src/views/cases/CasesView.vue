<script setup lang="ts">
/**
 * B12 案例投稿审核（二期预留）（设计稿 docs/design/admin/B12.png，设计宽度 1440）
 *
 * 投稿队列；可识别风险检查清单；第三方信息去除对照；授权范围；
 * 发布按钮受功能开关（案例卡片）控制。禁止“导出群聊后直接公开”或“删除昵称”当充分匿名化。
 *
 * 数据来自 server 接口（/admin/cases）：
 * - GET  /admin/cases              投稿队列
 * - GET  /admin/cases/{id}         详情（风险检查清单）
 * - POST /admin/cases/{id}/send-suggestion  发送编辑建议给用户
 * - POST /admin/cases/{id}/return   退回
 * - POST /admin/cases/{id}/publish  发布（开关未开启时不可用）
 */
import { onMounted, ref } from 'vue';
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { request } from '@/api/request'

interface CaseItem {
  id: string
  code: string
  user_masked: string
  summary: string
  consent_scope: string
  status: string
  created_at: string
}

interface RiskItem {
  key: string
  label: string
  status: 'pending' | 'detected' | 'cleared' | 'none' | 'labeled' | 'configured'
  count?: number
}

interface CaseDetail {
  id: string
  code: string
  user_masked: string
  user_submission: string
  status: string
  consent_scope: string | null
  created_at: string
  switch_enabled: boolean
  risk_checklist: RiskItem[]
}

const loading = ref(true)
const items = ref<CaseItem[]>([])
const switchEnabled = ref(false)
const selectedId = ref('')
const detail = ref<CaseDetail | null>(null)
const suggestion = ref('')
const submitting = ref('')

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  try {
    const res = await request<{ items: CaseItem[]; switch_enabled: boolean }>({ url: '/admin/cases' })
    items.value = res.items
    switchEnabled.value = res.switch_enabled
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

async function onSelect(item: CaseItem) {
  selectedId.value = item.id
  suggestion.value = ''
  try {
    detail.value = await request<CaseDetail>({ url: `/admin/cases/${item.id}` })
  } catch (e) {
    notify(e instanceof Error ? e.message : '加载失败')
  }
}

async function onSendSuggestion() {
  if (!detail.value) return
  if (!suggestion.value.trim()) {
    notify('请填写编辑建议')
    return
  }
  submitting.value = 'suggestion'
  try {
    await request({
      url: `/admin/cases/${detail.value.id}/send-suggestion`,
      method: 'POST',
      data: { suggestion: suggestion.value.trim() },
    })
    notify('编辑建议已发送给用户（需用户确认）')
    await load()
    if (selectedId.value) {
      detail.value = await request<CaseDetail>({ url: `/admin/cases/${selectedId.value}` })
    }
  } catch (e) {
    notify(e instanceof Error ? e.message : '发送失败')
  } finally {
    submitting.value = ''
  }
}

async function onReturn() {
  if (!detail.value) return
  if (!confirmAction('确认退回给用户编辑？')) return
  submitting.value = 'return'
  try {
    await request({
      url: `/admin/cases/${detail.value.id}/return`,
      method: 'POST',
      data: { reason: '需要进一步去除第三方信息' },
    })
    notify('已退回给用户编辑')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '退回失败')
  } finally {
    submitting.value = ''
  }
}

async function onPublish() {
  if (!detail.value) return
  if (!switchEnabled.value) {
    notify('案例卡片功能未开启（二期预留），当前不可发布')
    return
  }
  if (!confirmAction('确认发布该投稿？发布将生成公开卡片并进入索引。')) return
  submitting.value = 'publish'
  try {
    await request({ url: `/admin/cases/${detail.value.id}/publish`, method: 'POST' })
    notify('已发布（写入审计）')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '发布失败')
  } finally {
    submitting.value = ''
  }
}

function riskTag(r: RiskItem): { key: 'confirmed' | 'unconfirmed' | 'conflict' | 'self' | 'quote'; text: string } {
  switch (r.status) {
    case 'cleared':
      return { key: 'confirmed', text: '已清除' }
    case 'detected':
      return { key: 'conflict', text: `检测到 ${r.count ?? 2} 处（见右侧）` }
    case 'none':
      return { key: 'self', text: '无' }
    case 'labeled':
      return { key: 'quote', text: '已标注：随访中' }
    case 'configured':
      return { key: 'confirmed', text: '已配置' }
    default:
      return { key: 'unconfirmed', text: '待人工判断' }
  }
}
</script>

<template>
  <div class="cases-page">
    <!-- 二期提示 -->
    <AppCard class="banner">
      <AppNotice type="warn">
        <strong>二期功能 · 首版隐藏（功能开关 case_cards = off）</strong><br />
        进入条件：单独授权、预览、第三方信息去除、人工审核、撤回链路可用。禁止把“导出群聊后直接公开”或“删除昵称”当作充分匿名化。以下为界面预留，数据为演示。
      </AppNotice>
    </AppCard>

    <div class="cases-grid">
      <!-- 左：队列 + 风险检查 -->
      <section class="cases-left">
        <AppCard class="panel">
          <div class="panel__head">
            <h2 class="panel__title">投稿队列</h2>
            <div class="panel__head-right">
              <StatusTag status="unconfirmed" text="待审" />
              <StatusTag status="confirmed" text="已发布" />
              <StatusTag status="offline" text="已撤回" />
            </div>
          </div>
          <div v-if="loading" class="panel__loading">正在加载…</div>
          <table v-else class="table">
            <thead>
              <tr>
                <th>投稿</th>
                <th>摘要（经用户编辑的片段）</th>
                <th>授权范围</th>
                <th>第三方信息</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in items"
                :key="item.id"
                :class="{ 'table__row--selected': selectedId === item.id }"
                @click="onSelect(item)"
              >
                <td class="table__id">{{ item.code }}</td>
                <td class="table__summary">{{ item.summary }}</td>
                <td>
                  <StatusTag v-if="item.consent_scope === '发表 + 产品改进'" status="self" :text="item.consent_scope" />
                  <StatusTag v-else-if="item.consent_scope && item.consent_scope !== '—'" status="self" :text="item.consent_scope" />
                  <span v-else>—</span>
                </td>
                <td>
                  <StatusTag v-if="item.code === '#CS-0003'" status="conflict" text="检测到 2 处" />
                  <StatusTag v-else-if="item.status === '待审'" status="unconfirmed" text="待审" />
                  <StatusTag v-else-if="item.status === '已撤回'" status="offline" text="已撤回" />
                  <StatusTag v-else status="confirmed" text="已清除" />
                </td>
                <td>
                  <StatusTag v-if="item.status === '待审'" status="unconfirmed" :text="item.status" />
                  <StatusTag v-else-if="item.status === '已发布'" status="confirmed" :text="item.status" />
                  <StatusTag v-else status="offline" :text="item.status" />
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="5" class="table__empty">还没有投稿</td>
              </tr>
            </tbody>
          </table>
        </AppCard>

        <AppCard class="panel">
          <div class="panel__head">
            <h2 class="panel__title"><span aria-hidden="true">⚠</span> 可识别风险检查（发布前必过）</h2>
            <AppButton type="soft" size="sm" @click="notify('逐项复核界面将在后续版本提供')">逐项复核</AppButton>
          </div>
          <ul class="risk-list">
            <li v-for="r in detail?.risk_checklist ?? []" :key="r.key" class="risk-item">
              <span class="risk-item__label">{{ r.label }}</span>
              <StatusTag :status="riskTag(r).key" :text="riskTag(r).text" />
            </li>
            <li v-if="!detail" class="risk-item">选择一条投稿查看风险检查清单</li>
          </ul>
        </AppCard>
      </section>

      <!-- 右：投稿详情 -->
      <aside class="cases-aside">
        <AppCard v-if="detail" class="panel">
          <div class="panel__head">
            <h2 class="panel__title">{{ detail.code }} · 第三方信息去除</h2>
            <StatusTag v-if="detail.status === '待审'" status="unconfirmed" text="待审" />
            <StatusTag v-else-if="detail.status === '已发布'" status="confirmed" :text="detail.status" />
            <StatusTag v-else status="offline" :text="detail.status" />
          </div>

          <div class="block">
            <p class="block__title">用户提交（已由用户自行编辑）</p>
            <p class="block__text">{{ detail.user_submission }}</p>
          </div>

          <div class="block">
            <p class="block__title">编辑建议（运营编辑，需用户确认）</p>
            <p class="block__text">
              复查那天还是接诊医生看的，医生说和上次比没有明显变化，让我继续按之前的方案，在当地医院做康复。
            </p>
          </div>

          <div class="block">
            <p class="block__title">授权范围（用户单独勾选）</p>
            <ul class="consent-list">
              <li><StatusTag status="confirmed" text="✓" /> 发表为匿名案例卡片</li>
              <li><StatusTag status="confirmed" text="✓" /> 用于产品改进（解释缺口分析）</li>
              <li><StatusTag status="self" text="—" /> 用于模型训练</li>
            </ul>
          </div>

          <div class="block">
            <label class="block__label" for="suggestion">发送编辑建议给用户</label>
            <textarea id="suggestion" v-model="suggestion" class="block__textarea" placeholder="例如：请补充症状开始的时间与最近一次复查结论" />
            <div class="block__actions">
              <AppButton type="soft" size="sm" :loading="submitting === 'suggestion'" @click="onSendSuggestion">发送编辑建议给用户</AppButton>
              <AppButton type="soft" size="sm" :loading="submitting === 'return'" @click="onReturn">退回</AppButton>
              <AppButton
                type="primary"
                size="sm"
                :loading="submitting === 'publish'"
                :disabled="!switchEnabled"
                @click="onPublish"
              >
                发布（功能未开启）
              </AppButton>
            </div>
          </div>

          <AppNotice type="info">
            去标识化不等于永久匿名。发布许可、产品改进与模型训练用途分别说明；案例只扩展“其他人经历过什么”，不进入回答“医学证据支持什么”的知识库。
          </AppNotice>
        </AppCard>

        <AppCard v-else class="panel">
          <p class="panel__hint">在左侧队列选择一条投稿查看详情。</p>
        </AppCard>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.cases-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.banner {
  background: var(--color-warn-light);
  border-color: var(--color-warn);
}

.cases-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.cases-left,
.cases-aside {
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
  gap: var(--spacing-xs);
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
  vertical-align: top;
  cursor: pointer;
}

.table tbody tr:hover td {
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

.table__summary {
  max-width: 280px;
  line-height: var(--line-height-body);
}

.table__empty {
  text-align: center;
  color: var(--color-text-3);
  padding: var(--spacing-xl);
}

/* ---------- 风险检查 ---------- */
.risk-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.risk-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-aux-sm);
}

.risk-item:first-child {
  border-top: none;
}

.risk-item__label {
  flex: 1;
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

/* ---------- 详情块 ---------- */
.block {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
}

.block__title,
.block__label {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-2);
}

.block__text {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.consent-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.consent-list li {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
}

.block__textarea {
  width: 100%;
  min-height: 72px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  resize: vertical;
}

.block__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

@media (max-width: 1200px) {
  .cases-grid {
    grid-template-columns: 1fr;
  }
}
</style>
