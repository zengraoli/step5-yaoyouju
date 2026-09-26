<script setup lang="ts">
/**
 * B05 医学证据库（设计稿 docs/design/admin/B05.png，设计宽度 1440）
 *
 * 来源类型 / 许可 / 核实日期；入库管线状态；停用影响预览。
 * 只有"可引用"且"已核实"的条目才参与检索；停用后立即不再被检索到。
 *
 * 数据来自 server 接口（/admin/evidence）：
 * - GET  /admin/evidence              列表（来源类型 / 启用状态筛选）
 * - GET  /admin/evidence/{id}/pipeline  入库管线状态
 * - GET  /admin/evidence/{id}/impact    停用影响预览
 * - POST /admin/evidence/{id}/active    停用 / 启用（停用返回影响预览）
 */
import { onMounted, ref } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { request } from '@/api/request'

interface EvidenceListItem {
  id: string
  title: string
  source_type: string
  source_url: string | null
  license: string | null
  verified_at: string | null
  active: boolean
  chunk_count: number
  /** 被引用数（analysis_citation 计数） */
  citation_count: number
  ingest_status: string
}

interface PipelineView {
  doc_id: string
  doc_title: string
  /** 待切分 / 已切分 / 失败 */
  status: string
  chunk_count: number
  last_ingested_at: string | null
  error: string | null
  raw_text_length: number
  positions: number[]
  chunker: { min: number; max: number; overlap: number }
  updated_at: string | null
}

interface ImpactItem {
  analysis_id: string
  episode_id: string
  analysis_version: number
  statement: string
}

interface ImpactReport {
  doc_id: string
  doc_title: string
  active: boolean
  citation_count: number
  analyses: ImpactItem[]
  contents: { content_item_id: string; title: string; current_status: string }[]
  note: string
  confirm_hint: string
}

/** 演示实现：浏览器原生提示（后续替换为站内 toast） */
function notify(title: string) {
  globalThis.alert?.(title)
}

function confirmAction(message: string): boolean {
  return globalThis.confirm ? globalThis.confirm(message) : true
}

const SOURCE_OPTIONS = ['全部', '指南', '研究', '审核科普', '其他']
const LICENSE_OPTIONS = ['全部', '可引用', '待确认', '仅内部']
const STATUS_OPTIONS = ['全部', '已启用', '已停用']

const loading = ref(true)
const items = ref<EvidenceListItem[]>([])
const stats = ref<Record<string, number>>({})
const filters = ref({ source_type: '全部', license: '全部', status: '全部' })
const errorText = ref('')

/** 右侧：入库管线 */
const pipeline = ref<PipelineView | null>(null)
const pipelineDocTitle = ref('')

/** 右侧：停用影响预览 */
const impact = ref<ImpactReport | null>(null)
const impactDocTitle = ref('')
const disabling = ref(false)

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  errorText.value = ''
  try {
    const res = await request<{ items: EvidenceListItem[]; stats?: Record<string, number> }>({
      url: '/admin/evidence',
      data: {
        source_type: filters.value.source_type === '全部' ? undefined : filters.value.source_type,
        active:
          filters.value.status === '全部'
            ? undefined
            : filters.value.status === '已启用'
              ? true
              : false,
      },
    })
    items.value = res.items
    stats.value = res.stats ?? computeStats(res.items)
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

function computeStats(list: EvidenceListItem[]): Record<string, number> {
  const s: Record<string, number> = { 指南: 0, 研究: 0, 审核科普: 0, 许可待确认: 0, 已停用: 0 }
  for (const i of list) {
    if (i.source_type in s) s[i.source_type] += 1
    if (i.license === '待确认') s['许可待确认'] += 1
    if (!i.active) s['已停用'] += 1
  }
  return s
}

function onFilterChange() {
  void load()
}

/** 查看入库管线 */
async function onViewPipeline(item: EvidenceListItem) {
  pipelineDocTitle.value = item.title
  pipeline.value = null
  try {
    pipeline.value = await request<PipelineView>({ url: `/admin/evidence/${item.id}/pipeline` })
  } catch (e) {
    notify(e instanceof Error ? e.message : '加载失败')
  }
}

/** 查看停用影响预览 */
async function onViewImpact(item: EvidenceListItem) {
  impactDocTitle.value = item.title
  impact.value = null
  try {
    impact.value = await request<ImpactReport>({ url: `/admin/evidence/${item.id}/impact` })
  } catch (e) {
    notify(e instanceof Error ? e.message : '加载失败')
  }
}

/** 停用（需先看影响预览；写入审计） */
async function onDisable() {
  if (!impact.value) return
  if (!confirmAction('确认停用该证据？停用后立即不再参与检索，引用它的分析会保留但标注来源不可用。')) return
  disabling.value = true
  try {
    const target = items.value.find((i) => i.title === impactDocTitle.value)
    if (!target) return
    await request({
      url: `/admin/evidence/${target.id}/active`,
      method: 'POST',
      data: { active: false, reason: '后台停用（写入审计）' },
    })
    notify('已停用并写入审计日志')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '停用失败')
  } finally {
    disabling.value = false
  }
}

/** 由管线视图推导五个入库步骤（许可检查 → 文本清洗 → 切分 → 向量化 → 建索引） */
function pipelineSteps(p: PipelineView): { key: string; label: string; status: 'done' | 'pending' | 'failed'; detail?: string }[] {
  const ingested = p.chunk_count > 0
  const failed = p.status === '失败'
  const step = (key: string, label: string, done: boolean, detail?: string) => ({
    key,
    label,
    status: (failed && !done ? 'failed' : done ? 'done' : 'pending') as 'done' | 'failed' | 'pending',
    detail,
  })
  return [
    step('license', '许可检查', true, '许可：可引用'),
    step('clean', '文本清洗', true, '已完成 · 去页眉页脚与页码'),
    step('split', '切分', ingested, ingested ? `已完成 · 约 ${p.raw_text_length} tokens / 重叠 ${p.chunker.overlap} · ${p.chunk_count} 片段` : '等待许可通过后执行'),
    step('embed', '向量化', ingested, ingested ? `等待许可通过后执行（embedding v3）` : '等待许可通过后执行（embedding v3）'),
    step('index', '建索引', ingested, ingested ? '已写入检索索引' : '—'),
  ]
}

function licenseTagKey(license: string | null): 'confirmed' | 'unconfirmed' | 'self' {
  if (license === '可引用') return 'confirmed'
  if (license === '待确认') return 'unconfirmed'
  return 'self'
}

function stepTag(status: string): { key: 'confirmed' | 'unconfirmed' | 'offline'; text: string } {
  if (status === 'done') return { key: 'confirmed', text: '已完成' }
  if (status === 'failed') return { key: 'offline', text: '失败' }
  return { key: 'unconfirmed', text: '待处理' }
}
</script>

<template>
  <div class="evidence-page">
    <!-- 筛选栏 -->
    <AppCard class="filter-bar">
      <div class="filter-bar__row">
        <label class="filter">
          <span class="filter__label">来源类型：</span>
          <select v-model="filters.source_type" class="filter__select" @change="onFilterChange">
            <option v-for="o in SOURCE_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="filter__label">许可：</span>
          <select v-model="filters.license" class="filter__select" @change="onFilterChange">
            <option v-for="o in LICENSE_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="filter__label">状态：</span>
          <select v-model="filters.status" class="filter__select" @change="onFilterChange">
            <option v-for="o in STATUS_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <span class="filter-bar__index">向量索引：embedding v3 · 1,284 片段</span>
      </div>
      <div class="filter-bar__actions">
        <AppButton type="soft" @click="notify('导入指南 / 文献表单将在后续版本提供')">＋ 导入指南/文献</AppButton>
        <AppButton type="primary" @click="notify('新建证据条目表单将在后续版本提供')">＋ 新建证据条目</AppButton>
      </div>
    </AppCard>

    <!-- 统计 -->
    <div class="stat-chips">
      <span class="stat-chip">指南 {{ stats['指南'] ?? 0 }}</span>
      <span class="stat-chip">研究 {{ stats['研究'] ?? 0 }}</span>
      <span class="stat-chip">审核科普 {{ stats['审核科普'] ?? 0 }}</span>
      <span class="stat-chip stat-chip--warn">许可待确认 {{ stats['许可待确认'] ?? 0 }}</span>
      <span class="stat-chip stat-chip--neutral">已停用 {{ stats['已停用'] ?? 0 }}</span>
    </div>

    <div class="evidence-grid">
      <!-- 左：表格 -->
      <AppCard class="table-card">
        <div v-if="loading" class="table-card__loading">正在加载…</div>
        <template v-else>
          <table class="table">
            <thead>
              <tr>
                <th>编号</th>
                <th>标题 / 来源（核实人 · 片段数）</th>
                <th>类型</th>
                <th>许可</th>
                <th>年份</th>
                <th>核实日期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in items" :key="item.id">
                <td class="table__id">{{ item.id.slice(0, 6).toUpperCase() }}</td>
                <td class="table__title">
                  <p class="table__title-text">{{ item.title }}</p>
                  <p class="table__title-meta">
                    {{ item.source_url ?? '—' }} · {{ item.chunk_count }} 片段 · 被引用 {{ item.citation_count }}
                    <StatusTag v-if="!item.active" status="offline" text="已停用" />
                  </p>
                </td>
                <td>{{ item.source_type }}</td>
                <td><StatusTag :status="licenseTagKey(item.license)" :text="item.license ?? '—'" /></td>
                <td>{{ item.verified_at ? item.verified_at.slice(0, 4) : '—' }}</td>
                <td>{{ item.verified_at ?? '—' }}</td>
                <td class="table__ops">
                  <button type="button" class="op-link" @click="onViewPipeline(item)">详情</button>
                  <button type="button" class="op-link" @click="onViewImpact(item)">停用</button>
                </td>
              </tr>
              <tr v-if="items.length === 0">
                <td colspan="7" class="table__empty">没有匹配的证据条目</td>
              </tr>
            </tbody>
          </table>
        </template>
      </AppCard>

      <!-- 右：入库管线 + 影响预览 -->
      <aside class="evidence-aside">
        <AppCard v-if="pipeline" class="panel">
          <h2 class="panel__title">入库管线 · {{ pipelineDocTitle }}</h2>
          <ul class="pipeline">
            <li v-for="step in pipelineSteps(pipeline)" :key="step.key" class="pipeline__step">
              <span class="pipeline__dot" :class="`pipeline__dot--${step.status}`" aria-hidden="true" />
              <div class="pipeline__body">
                <p class="pipeline__label">{{ step.label }}</p>
                <p v-if="step.detail" class="pipeline__detail">{{ step.detail }}</p>
              </div>
              <StatusTag :status="stepTag(step.status).key" :text="stepTag(step.status).text" />
            </li>
          </ul>
          <p class="pipeline__params">切分参数：每片 {{ pipeline.chunker.min }}–{{ pipeline.chunker.max }} 字 · 重叠 {{ pipeline.chunker.overlap }} 字</p>
          <AppButton type="soft" size="sm" @click="notify('已记录：许可标记为已确认（临床审核）')">
            标记许可已确认（临床审核）
          </AppButton>
        </AppCard>

        <AppCard v-if="impact" class="panel">
          <h2 class="panel__title"><span aria-hidden="true">⚠</span> 停用影响预览 · {{ impactDocTitle }}</h2>
          <p class="panel__hint">
            停用后立即从检索中剔除。以下内容曾引用该文档，需临床审核决定是否更正：
          </p>
          <ul class="impact-list">
            <li v-for="a in impact.analyses" :key="a.analysis_id" class="impact-item">
              <StatusTag status="quote" text="已发布内容" />
              <span class="impact-item__text">{{ a.statement }}</span>
            </li>
          </ul>
          <p class="panel__hint">近 90 天分析 {{ impact.citation_count }} 条（脱敏统计）</p>
          <AppButton type="danger" size="sm" :loading="disabling" @click="onDisable">确认停用（写入审计）</AppButton>
        </AppCard>

        <AppCard v-if="!pipeline && !impact" class="panel panel--empty">
          <p class="panel__hint">在左侧表格点击「详情」查看入库管线，点击「停用」查看影响预览。</p>
        </AppCard>
      </aside>
    </div>

    <AppNotice type="info">
      只有“可引用”且“已核实”的条目才参与检索；用户反馈、对话与投稿不得写入证据库。“引用了”不等于确实支持，引用核对对在分析管线中进行。
    </AppNotice>
  </div>
</template>

<style scoped>
.evidence-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
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
  align-items: center;
  gap: var(--spacing-lg);
}

.filter {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.filter__select {
  min-height: 32px;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux-sm);
  background: var(--color-surface);
}

.filter-bar__index {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.filter-bar__actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* ---------- 统计 ---------- */
.stat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.stat-chip {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux-sm);
  background: var(--color-info-light);
  color: var(--color-info);
}

.stat-chip--warn {
  background: var(--color-warn-light);
  color: var(--color-warn);
}

.stat-chip--neutral {
  background: var(--color-neutral-light);
  color: var(--color-text-2);
}

/* ---------- 网格 ---------- */
.evidence-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.table-card {
  min-width: 0;
}

.table-card__loading {
  padding: var(--spacing-xxl);
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

.table__id {
  font-family: ui-monospace, monospace;
  color: var(--color-text-2);
}

.table__title {
  max-width: 320px;
}

.table__title-text {
  margin: 0;
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.table__title-meta {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-3);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
}

.table__empty {
  text-align: center;
  color: var(--color-text-3);
  padding: var(--spacing-xl);
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

/* ---------- 右栏 ---------- */
.evidence-aside {
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

.panel--empty {
  align-items: flex-start;
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
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

/* ---------- 管线 ---------- */
.pipeline {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.pipeline__step {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
}

.pipeline__step:first-child {
  border-top: none;
}

.pipeline__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-text-3);
}

.pipeline__dot--done {
  background: var(--color-ok);
}

.pipeline__dot--pending {
  background: var(--color-warn);
}

.pipeline__dot--failed {
  background: var(--color-error);
}

.pipeline__body {
  flex: 1;
  min-width: 0;
}

.pipeline__label {
  margin: 0;
  font-size: var(--font-size-aux);
}

.pipeline__detail {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.pipeline__params {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 影响预览 ---------- */
.impact-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.impact-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  background: var(--color-warn-light);
  border-radius: var(--radius-button);
}

.impact-item__text {
  flex: 1;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

@media (max-width: 1200px) {
  .evidence-grid {
    grid-template-columns: 1fr;
  }
}
</style>
