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
import { computed, onMounted, ref } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { request } from '@/api/request'
import { useAuthStore } from '@/stores/auth'

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
  analysis_count?: number
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

/** 索引统计（真实片段数与文档数） */
const indexStats = ref({ chunks: 0, docs: 0 })

/** 新建 / 导入证据表单 */
const showCreate = ref(false)
const createMode = ref<'create' | 'import'>('create')
const createForm = ref({ title: '', source_type: '指南', source_url: '', license: '待确认', raw_text: '' })
const creating = ref(false)

const auth = useAuthStore()

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
const verifying = ref(false)
/** 当前管线文档的许可是否为「可引用」（未确认时不参与用户检索） */
const pipelineLicenseOk = computed<boolean>(() => {
  const doc = items.value.find((i) => i.title === pipelineDocTitle.value)
  return doc?.license === '可引用'
})

onMounted(async () => {
  await load()
})

async function loadIndexStats() {
  try {
    const docs = await request<EvidenceListItem[]>({ url: '/admin/evidence' })
    indexStats.value = {
      chunks: docs.reduce((n, d) => n + (d.chunk_count ?? 0), 0),
      docs: docs.length,
    }
  } catch {
    indexStats.value = { chunks: 0, docs: 0 }
  }
}

async function submitCreate() {
  creating.value = true
  try {
    await request<{ id: string }>({
      url: '/admin/evidence',
      method: 'POST',
      data: {
        title: createForm.value.title.trim(),
        source_type: createForm.value.source_type,
        source_url: createForm.value.source_url.trim() || undefined,
        license: createForm.value.license,
        raw_text: createForm.value.raw_text.trim() || undefined,
      },
    })
    notify('已创建证据条目，许可确认后才可被用户检索引用')
    showCreate.value = false
    createForm.value = { title: '', source_type: '指南', source_url: '', license: '待确认', raw_text: '' }
    await Promise.all([load(), loadIndexStats()])
  } catch (e) {
    notify(e instanceof Error ? e.message : '创建失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

async function load() {
  loading.value = true
  errorText.value = ''
  try {
    const query = {
      source_type: filters.value.source_type === '全部' ? undefined : filters.value.source_type,
      active:
        filters.value.status === '全部'
          ? undefined
          : filters.value.status === '已启用'
            ? true
            : false,
    }
    // 列表（带筛选）与统计（全量口径，不受筛选影响）分开请求；接口返回裸数组
    const [list, all] = await Promise.all([
      request<EvidenceListItem[]>({ url: '/admin/evidence', data: query }),
      request<EvidenceListItem[]>({ url: '/admin/evidence' }),
    ])
    items.value = Array.isArray(list) ? list : []
    const allDocs = Array.isArray(all) ? all : []
    stats.value = computeStats(allDocs)
    // 索引统计（首屏也要真实：onMounted 只走 load，故在此一并计算真实片段数 / 文档数）
    indexStats.value = {
      chunks: allDocs.reduce((n, d) => n + (d.chunk_count ?? 0), 0),
      docs: allDocs.length,
    }
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '数据加载失败'
    items.value = []
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

/** 标记许可已确认（临床审核 / 超级管理）：许可置为「可引用」并记录核实日期，写审计 */
async function onVerifyLicense() {
  const target =
    items.value.find((i) => i.title === pipelineDocTitle.value) ??
    items.value.find((i) => i.license !== '可引用') ??
    items.value[0]
  if (!target) return
  if (!auth.hasPermission('evidence.verify') && !auth.hasPermission('*')) {
    notify('只有临床审核或超级管理员可以标记许可已确认')
    return
  }
  const date = globalThis.prompt ? globalThis.prompt('请输入核实日期（YYYY-MM-DD，默认今天）', todayIso()) : todayIso()
  if (!date) return
  verifying.value = true
  try {
    await request({
      url: `/admin/evidence/${encodeURIComponent(target.id)}/verify-license`,
      method: 'POST',
      data: { verified_at: date.trim() || undefined },
    })
    notify(`已标记《${target.title}》许可为「可引用」（核实日期 ${date.trim() || todayIso()}）`)
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '标记失败')
  } finally {
    verifying.value = false
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
function pipelineSteps(
  p: PipelineView,
  licenseOk: boolean,
): { key: string; label: string; status: 'done' | 'pending' | 'failed'; detail?: string }[] {
  const ingested = p.chunk_count > 0
  const failed = p.status === '失败'
  const step = (key: string, label: string, done: boolean, detail?: string) => ({
    key,
    label,
    status: (failed && !done ? 'failed' : done ? 'done' : 'pending') as 'done' | 'failed' | 'pending',
    detail,
  })
  return [
    step('license', '许可检查', licenseOk, licenseOk ? '许可：可引用（临床审核已确认）' : '许可：待确认——标记为「可引用」后才会参与用户检索'),
    step('clean', '文本清洗', ingested, ingested ? '已完成 · 去页眉页脚与页码' : '切分入库时执行'),
    step('split', '切分', ingested, ingested ? `已完成 · 约 ${p.raw_text_length} 字 / 重叠 ${p.chunker.overlap} 字 · ${p.chunk_count} 片段` : licenseOk ? '点击「切分入库」执行' : '等待许可通过后执行'),
    step('embed', '向量化', ingested, ingested ? `已计算本地向量（${p.chunk_count} 条，写入 embedding 列）` : licenseOk ? '切分后自动计算' : '等待许可通过后执行'),
    step('index', '建索引', ingested, ingested ? '已写入检索索引（用户检索可见）' : '—'),
  ]
}

/** 今天的北京时间日期（YYYY-MM-DD） */
function todayIso(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
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
        <span class="filter-bar__index">向量索引：本地 16 维演示向量 · {{ indexStats.chunks }} 片段 / {{ indexStats.docs }} 篇</span>
      </div>
      <div class="filter-bar__actions">
        <AppButton type="soft" @click="showCreate = true; createMode = 'import'">＋ 导入指南/文献</AppButton>
        <AppButton type="primary" @click="showCreate = true; createMode = 'create'">＋ 新建证据条目</AppButton>
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
            <li v-for="step in pipelineSteps(pipeline, pipelineLicenseOk)" :key="step.key" class="pipeline__step">
              <span class="pipeline__dot" :class="`pipeline__dot--${step.status}`" aria-hidden="true" />
              <div class="pipeline__body">
                <p class="pipeline__label">{{ step.label }}</p>
                <p v-if="step.detail" class="pipeline__detail">{{ step.detail }}</p>
              </div>
              <StatusTag :status="stepTag(step.status).key" :text="stepTag(step.status).text" />
            </li>
          </ul>
          <p class="pipeline__params">切分参数：每片 {{ pipeline.chunker.min }}–{{ pipeline.chunker.max }} 字 · 重叠 {{ pipeline.chunker.overlap }} 字</p>
          <AppButton type="soft" size="sm" :loading="verifying" @click="onVerifyLicense">
            标记许可已确认（临床审核）
          </AppButton>
        </AppCard>

        <AppCard v-if="impact" class="panel">
          <h2 class="panel__title"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.8 2.9 19.6h18.2z" /><path d="M12 9.6v4.2" /><path d="M12 16.6v.4" /></svg> 停用影响预览 · {{ impactDocTitle }}</h2>
          <p class="panel__hint">
            停用后立即从检索中剔除。以下内容曾引用该文档，需临床审核决定是否更正：
          </p>
          <ul class="impact-list">
            <li v-for="a in impact.analyses" :key="a.analysis_id" class="impact-item">
              <StatusTag status="generated" :text="`一页分析 v${a.analysis_version}`" />
              <span class="impact-item__text">{{ a.statement }}</span>
            </li>
          </ul>
          <p class="panel__hint">关联分析 {{ impact.analysis_count ?? impact.analyses.length }} 条 · 引用 {{ impact.citation_count }} 处（脱敏统计）</p>
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

  <!-- 新建 / 导入证据条目（许可默认「待确认」，需临床审核确认后才可引用） -->
  <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
    <AppCard class="modal">
      <h3 class="modal__title">{{ createMode === 'create' ? '新建证据条目' : '导入指南 / 文献' }}</h3>
      <p class="modal__desc">许可默认「待确认」：只有临床审核标记许可已确认后，条目才会参与用户检索。</p>
      <label class="modal__field">
        <span>标题</span>
        <input v-model="createForm.title" class="modal__input" type="text" maxlength="200" placeholder="例如：腰椎间盘突出症诊疗指南" />
      </label>
      <label class="modal__field">
        <span>来源类型</span>
        <select v-model="createForm.source_type" class="modal__input">
          <option v-for="o in SOURCE_OPTIONS" :key="o" :value="o">{{ o }}</option>
        </select>
      </label>
      <label class="modal__field">
        <span>来源地址（可选）</span>
        <input v-model="createForm.source_url" class="modal__input" type="text" maxlength="300" placeholder="https://…" />
      </label>
      <label class="modal__field">
        <span>原文 / 摘要</span>
        <textarea v-model="createForm.raw_text" class="modal__input modal__input--area" rows="5" maxlength="20000" placeholder="粘贴指南或文献原文，保存后可切分入库" />
      </label>
      <div class="modal__actions">
        <AppButton type="primary" :disabled="creating || !createForm.title.trim()" @click="submitCreate">
          {{ creating ? '提交中…' : '创建' }}
        </AppButton>
        <AppButton type="soft" @click="showCreate = false">取消</AppButton>
      </div>
    </AppCard>
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
  max-width: 560px;
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
.modal__input--area {
  height: auto;
  padding: var(--spacing-sm);
  line-height: 1.6;
}
.modal__actions {
  display: flex;
  gap: var(--spacing-sm);
}
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
