<script setup lang="ts">
/**
 * B03 内容库列表（设计稿 docs/design/admin/B03.png，设计宽度 1440）
 *
 * 筛选 / 状态统计；表格含状态、版本、审核人、引用数、下线开关；
 * 批量下线需双人确认；用户端只能看到已发布内容。
 *
 * 数据来自 server 接口：GET /admin/contents、POST /admin/contents/batch-take-offline
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import {
  batchTakeOffline,
  contentImpact,
  createDraft,
  listContentsAdmin,
  takeOffline,
  withdrawContent,
  type ContentAdminItem,
} from '@/api/contents'

/** 筛选选项（按设计稿） */
const TYPE_OPTIONS = ['全部', '视频', '图文组件', '案例']
const STATUS_OPTIONS = ['全部', '草稿', '待医学审核', '已审定', '已发布', '更正中', '已撤回', '已下线']
const SCOPE_OPTIONS = ['全部', '报告术语', '病程变化', '复诊准备', '生活影响', '信息来源']
/**
 * 审核人下拉：只列当前内容里真实出现过的审核人（来自内容列表本身）。
 * 不再请求 /admin/users：运营编辑 / 临床审核没有该权限，
 * 每次加载都会产生 403 并在审计里堆出越权记录（验收反馈第 43 条）。
 */
const reviewerOptions = ref<string[]>(['全部'])

function syncReviewerOptions(list: ContentAdminItem[]) {
  const names = [...new Set(list.map((i) => i.reviewer).filter((n): n is string => Boolean(n)))]
  reviewerOptions.value = ['全部', ...names]
}

const router = useRouter()

const loading = ref(true)
const items = ref<ContentAdminItem[]>([])
const stats = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const selected = ref<string[]>([])
const errorText = ref('')
const busy = ref(false)

const filters = ref({ type: '全部', status: '全部', scope: '全部', reviewer: '全部' })

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  errorText.value = ''
  try {
    const res = await listContentsAdmin({
      type: filters.value.type,
      status: filters.value.status,
      scope: filters.value.scope,
      reviewer: filters.value.reviewer,
      page: page.value,
      page_size: pageSize.value,
    })
    items.value = res.items
    stats.value = res.stats
    total.value = res.total
    syncReviewerOptions(res.items)
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

/** 演示实现：浏览器原生提示（后续替换为站内 toast） */
function notify(title: string) {
  globalThis.alert?.(title)
}

function confirmAction(message: string): boolean {
  return globalThis.confirm ? globalThis.confirm(message) : true
}

/** 「···」更多操作菜单（第七轮第 7 条：菜单里的每个动作都要真的能执行） */
const menuFor = ref('')
function onMore(id: string) {
  menuFor.value = menuFor.value === id ? '' : id
}

/** 引用定位：列出这条内容被哪些一页分析 / 复诊摘要引用 */
async function onImpact(item: ContentAdminItem) {
  menuFor.value = ''
  try {
    const impact = await contentImpact(item.id)
    // 契约变化 / 空引用都不得崩溃，也不能 catch 后伪称成功（F12 第 5 条）
    const analyses = Array.isArray(impact?.analyses) ? impact.analyses : []
    const followups = Array.isArray(impact?.followups) ? impact.followups : []
    const lines = [
      `《${item.title}》引用定位：`,
      analyses.length === 0
        ? '· 暂无一页分析引用该内容'
        : `· 被一页分析引用 ${analyses.length} 处`,
      ...analyses.slice(0, 3).map((a) => `  - v${a.analysis_version}：${String(a.statement ?? '').slice(0, 40)}`),
      `· 出现在 ${followups.length} 份复诊摘要里`,
      impact?.note ?? '',
    ].filter((l) => l !== '')
    notify(lines.join('\n'))
  } catch (e) {
    notify(e instanceof Error ? e.message : '引用定位加载失败')
  }
}

/** 撤回（已发布 → 已撤回，需双人确认） */
async function onWithdraw(item: ContentAdminItem) {
  menuFor.value = ''
  if (!confirmAction(`确认发起撤回《${item.title}》？需要另一名临床审核 / 超级管理员确认后生效。`)) return
  try {
    await withdrawContent(item.id, '发现严重问题，发起撤回（双人确认）')
    notify('已发起撤回申请，请另一名具备权限的账号在「待我确认」里确认')
    await load()
  } catch (e) {
    const data = (e as { data?: { confirmation_id?: string } })?.data
    if (data?.confirmation_id) {
      notify('已发起撤回申请，请另一名具备权限的账号在「待我确认」里确认')
      await load()
      return
    }
    notify(e instanceof Error ? e.message : '撤回失败')
  }
}

/** 一键下线（已发布 → 已下线，需双人确认） */
async function onTakeOffline(item: ContentAdminItem) {
  menuFor.value = ''
  if (!confirmAction(`确认发起一键下线《${item.title}》？下线后用户端立即不可见，需另一人确认后生效。`)) return
  try {
    await takeOffline(item.id, '应急下线（双人确认）')
    notify('已发起下线申请，请另一名具备权限的账号在「待我确认」里确认')
    await load()
  } catch (e) {
    const data = (e as { data?: { pending?: { id: string; confirmation_id: string }[] } })?.data
    if (data?.pending) {
      notify('已发起下线申请，请另一名具备权限的账号在「待我确认」里确认')
      await load()
      return
    }
    notify(e instanceof Error ? e.message : '下线失败')
  }
}

function onFilterChange() {
  page.value = 1
  void load()
}

function onToggleSelect(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}

const allSelected = computed<boolean>(
  () => items.value.length > 0 && items.value.every((i) => selected.value.includes(i.id)),
)

function onToggleAll() {
  selected.value = allSelected.value ? [] : items.value.map((i) => i.id)
}

/** 批量下线（需双人确认：每条内容各一张确认单，另一人逐条确认后才真正下线） */
async function onBatchOffline() {
  if (selected.value.length === 0) {
    notify('请先选择内容')
    return
  }
  busy.value = true
  errorText.value = ''
  try {
    // 先逐条发起确认单（服务端会为还没有确认单的内容创建待确认申请）
    await batchTakeOffline([...selected.value], '批量下线（双人确认后执行）')
    notify(`已提交 ${selected.value.length} 条「一键下线」确认申请，请由另一名临床审核 / 超级管理员在上方「待我确认」里逐条确认`)
  } catch (e) {
    // 409 = 已提交确认申请（含待确认清单），这是正常的第一步
    const data = (e as { data?: { pending?: { id: string; confirmation_id: string }[] } })?.data
    if (data?.pending && Array.isArray(data.pending) && data.pending.length > 0) {
      notify(`已提交 ${data.pending.length} 条确认申请，请另一名具备权限的账号在上方「待我确认」里逐条确认并执行`)
    } else {
      errorText.value = e instanceof Error ? e.message : '批量下线失败'
    }
  } finally {
    busy.value = false
  }
}

/** 新建内容草稿（运营编辑 / 超级管理） */
function onCreate() {
  showCreate.value = true
}

const showCreate = ref(false)
const createForm = ref({ type: '视频', title: '', applicable_scope: '', not_applicable: '', script: '' })
const creating = ref(false)

async function submitCreate() {
  const title = createForm.value.title.trim()
  if (!title) {
    notify('请填写内容标题')
    return
  }
  if (!createForm.value.script.trim()) {
    notify('请填写脚本 / 正文（写入第一个版本）')
    return
  }
  creating.value = true
  try {
    const detail = await createDraft({
      type: createForm.value.type,
      title,
      applicable_scope: createForm.value.applicable_scope.trim() || '一般腰痛',
      not_applicable: createForm.value.not_applicable.trim() || '急性外伤 / 需紧急就医的情况',
      script: createForm.value.script.trim(),
    })
    notify(`已创建草稿《${title}》，请在详情页提交医学审核`)
    showCreate.value = false
    createForm.value = { type: '视频', title: '', applicable_scope: '', not_applicable: '', script: '' }
    await load()
    void detail
  } catch (e) {
    notify(e instanceof Error ? e.message : '创建草稿失败')
  } finally {
    creating.value = false
  }
}

function statusTagKey(status: string): 'confirmed' | 'unconfirmed' | 'unverified' | 'offline' | 'self' {
  if (status === '已发布') return 'confirmed'
  if (status === '待医学审核') return 'unconfirmed'
  if (status === '已审定') return 'confirmed'
  if (status === '草稿') return 'self'
  if (status === '更正中') return 'unverified'
  if (status === '已撤回' || status === '已下线') return 'offline'
  return 'self'
}

function statusTagText(status: string): string {
  if (status === '已下线') return '已下线'
  if (status === '已撤回') return '已撤回'
  return status
}

const pageCount = computed<number>(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
</script>

<template>
  <div class="contents-page">
    <!-- 筛选栏 -->
    <AppCard class="filter-bar">
      <div class="filter-bar__row">
        <label class="filter">
          <span class="filter__label">类型：</span>
          <select v-model="filters.type" class="filter__select" @change="onFilterChange">
            <option v-for="o in TYPE_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="filter__label">状态：</span>
          <select v-model="filters.status" class="filter__select" @change="onFilterChange">
            <option v-for="o in STATUS_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="filter__label">适用范围：</span>
          <select v-model="filters.scope" class="filter__select" @change="onFilterChange">
            <option v-for="o in SCOPE_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="filter">
          <span class="filter__label">审核人：</span>
          <select v-model="filters.reviewer" class="filter__select" @change="onFilterChange">
            <option v-for="o in reviewerOptions" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
      </div>
      <div class="filter-bar__actions">
        <AppButton type="soft" :disabled="selected.length === 0" @click="onBatchOffline">
          批量下线（需双人确认）
        </AppButton>
        <AppButton type="primary" @click="onCreate">＋ 新建内容</AppButton>
      </div>
    </AppCard>

    <!-- 状态统计 -->
    <div class="stat-chips">
      <span class="stat-chip">已发布 {{ stats['已发布'] ?? 0 }}</span>
      <span class="stat-chip stat-chip--warn">待医学审核 {{ stats['待医学审核'] ?? 0 }}</span>
      <span class="stat-chip stat-chip--neutral">草稿 {{ stats['草稿'] ?? 0 }}</span>
      <span class="stat-chip stat-chip--info">更正中 {{ stats['更正中'] ?? 0 }}</span>
      <span class="stat-chip stat-chip--neutral">已撤回 {{ stats['已撤回'] ?? 0 }}</span>
    </div>

    <AppCard class="table-card">
      <div v-if="loading" class="table-card__loading">正在加载…</div>
      <template v-else>
        <table class="table">
          <thead>
            <tr>
              <th class="table__check">
                <input type="checkbox" :checked="allSelected" @change="onToggleAll" />
              </th>
              <th>标题</th>
              <th>类型</th>
              <th>状态</th>
              <th>当前版本</th>
              <th>审核人</th>
              <th>发布时间</th>
              <th>引用数</th>
              <th>下线开关</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td class="table__check">
                <input type="checkbox" :checked="selected.includes(item.id)" @change="onToggleSelect(item.id)" />
              </td>
              <td class="table__title">{{ item.title }}</td>
              <td>{{ item.type }}</td>
              <td><StatusTag :status="statusTagKey(item.status)" :text="statusTagText(item.status)" /></td>
              <td>{{ item.current_version ? `v${item.current_version}` : '—' }}</td>
              <td>{{ item.reviewer ?? '—' }}</td>
              <td>{{ item.published_at ? item.published_at.slice(0, 10) : '—' }}</td>
              <td>{{ item.reference_count }}</td>
              <td>
                <span class="toggle" :class="{ 'toggle--on': item.offline }" aria-hidden="true" />
              </td>
              <td class="table__ops">
                <button type="button" class="op-link" @click="router.push(`/contents/${item.id}`)">详情</button>
                <button type="button" class="op-link" @click="router.push(`/contents/${item.id}`)">更正</button>
                <span class="more">
                  <button type="button" class="op-link op-link--muted" @click="onMore(item.id)">···</button>
                  <div v-if="menuFor === item.id" class="more__menu">
                    <button type="button" class="more__item" @click="onImpact(item)">引用定位</button>
                    <button
                      v-if="item.status === '已发布'"
                      type="button"
                      class="more__item"
                      @click="onWithdraw(item)"
                    >
                      撤回（双人确认）
                    </button>
                    <button
                      v-if="item.status === '已发布'"
                      type="button"
                      class="more__item more__item--danger"
                      @click="onTakeOffline(item)"
                    >
                      一键下线（双人确认）
                    </button>
                    <button
                      v-if="item.status === '已撤回' || item.status === '已下线'"
                      type="button"
                      class="more__item"
                      @click="menuFor = ''; router.push(`/contents/${item.id}`)"
                    >
                      修订后重审
                    </button>
                  </div>
                </span>
              </td>
            </tr>
            <tr v-if="items.length === 0">
              <td colspan="10" class="table__empty">没有匹配的内容</td>
            </tr>
          </tbody>
        </table>

        <div class="table-card__foot">
          <span class="table-card__total">共 {{ total }} 条 · 每页 {{ pageSize }} 条</span>
          <div class="pager">
            <button type="button" :disabled="page <= 1" @click="page -= 1; load()">‹</button>
            <span class="pager__current">{{ page }}</span>
            <button type="button" :disabled="page >= pageCount" @click="page += 1; load()">›</button>
          </div>
        </div>
      </template>
    </AppCard>

    <AppNotice type="warn">
      “下线开关”立即对用户端隐藏内容且不改变审核状态，用于应急；正式撤回请在详情页走“撤回”流程并定位引用页面。
    </AppNotice>

    <!-- 新建内容草稿弹层 -->
    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <AppCard class="modal">
        <h3 class="modal__title">新建内容草稿</h3>
        <p class="modal__desc">创建后进入草稿状态，需提交医学审核 → 临床审核 → 双人确认后才能发布。</p>
        <label class="modal__field">
          <span>类型</span>
          <select v-model="createForm.type" class="modal__input">
            <option value="视频">视频</option>
            <option value="图文组件">图文组件</option>
            <option value="案例">案例</option>
          </select>
        </label>
        <label class="modal__field">
          <span>标题</span>
          <input v-model="createForm.title" class="modal__input" type="text" maxlength="100" />
        </label>
        <label class="modal__field">
          <span>适用范围</span>
          <input v-model="createForm.applicable_scope" class="modal__input" type="text" maxlength="200" />
        </label>
        <label class="modal__field">
          <span>不适用范围</span>
          <input v-model="createForm.not_applicable" class="modal__input" type="text" maxlength="200" />
        </label>
        <label class="modal__field">
          <span>脚本 / 正文</span>
          <textarea v-model="createForm.script" class="modal__input" rows="4" maxlength="4000" />
        </label>
        <div class="modal__actions">
          <AppButton type="primary" :disabled="creating" @click="submitCreate">创建草稿</AppButton>
          <AppButton type="soft" @click="showCreate = false">取消</AppButton>
        </div>
      </AppCard>
    </div>
  </div>
</template>

<style scoped>
.contents-page {
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

.filter-bar__actions {
  display: flex;
  gap: var(--spacing-sm);
}

/* ---------- 状态统计 ---------- */
.stat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.stat-chip {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux-sm);
  background: var(--color-ok-light);
  color: var(--color-ok);
}

.stat-chip--warn {
  background: var(--color-warn-light);
  color: var(--color-warn);
}

.stat-chip--info {
  background: var(--color-info-light);
  color: var(--color-info);
}

.stat-chip--neutral {
  background: var(--color-neutral-light);
  color: var(--color-text-2);
}

/* ---------- 表格 ---------- */
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
  vertical-align: middle;
}

.table__check {
  width: 32px;
}

.table__title {
  max-width: 260px;
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

.op-link--muted {
  color: var(--color-text-3);
}

/* ---------- 「···」更多操作 ---------- */
.more {
  position: relative;
  display: inline-block;
}

.more__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  min-width: 168px;
  padding: var(--spacing-xs) 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  box-shadow: 0 8px 24px rgb(27 34 48 / 12%);
  display: flex;
  flex-direction: column;
}

.more__item {
  background: none;
  border: none;
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-text-1);
  cursor: pointer;
  white-space: nowrap;
}

.more__item:hover {
  background: var(--color-bg);
}

.more__item--danger {
  color: var(--color-danger, #c0392b);
}

.toggle {
  display: inline-block;
  width: 34px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: var(--color-border);
  position: relative;
  vertical-align: middle;
}

.toggle--on {
  background: var(--color-error);
}

.toggle--on::after {
  content: '';
  position: absolute;
  right: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
}

.toggle::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
}

.table-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: var(--spacing-md);
}

.table-card__total {
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
