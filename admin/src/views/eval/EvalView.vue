<script setup lang="ts">
/**
 * B09 评测集与回归结果（设计稿 docs/design/admin/B09.png，设计宽度 1440）
 *
 * 评测集列表（来源与门禁）；运行记录（触发原因）；失败用例（输入 / 期望 / 实际 / 判定，去标识化）。
 *
 * 数据来自 server 接口（/admin/eval，需 eval.manage 权限）：
 * - GET  /admin/eval/sets          评测集列表
 * - GET  /admin/eval/runs          运行记录（可按评测集筛选）
 * - GET  /admin/eval/runs/{id}     运行详情（含失败用例）
 * - POST /admin/eval/runs          运行评测
 */
import { computed, onMounted, ref } from 'vue';
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { request } from '@/api/request'

interface EvalSetItem {
  id: string
  name: string
  case_count: number
  deidentified: boolean
  latest_run: { id: string; result: string; created_at: string; model_release_id: string } | null
}

interface FailedCase {
  input?: string
  expected?: string
  actual?: string
  verdict?: string
  [key: string]: unknown
}

interface EvalRunItem {
  id: string
  model_release_id: string
  model_name: string
  prompt_version: string
  eval_set_id: string
  eval_set_name: string
  result: string
  metrics: Record<string, number>
  trigger_reason: string
  case_count: number
  passed_count: number
  failed_count: number
  failed_cases: FailedCase[]
  created_at: string
}

const loading = ref(true)
const sets = ref<EvalSetItem[]>([])
const runs = ref<EvalRunItem[]>([])
const filterSet = ref('全部')
const selectedRunId = ref('')
const running = ref(false)

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  try {
    const [setList, runList] = await Promise.all([
      request<EvalSetItem[]>({ url: '/admin/eval/sets' }),
      request<EvalRunItem[]>({
        url: '/admin/eval/runs',
        data: filterSet.value === '全部' ? undefined : { eval_set_id: filterSet.value },
      }),
    ])
    sets.value = Array.isArray(setList) ? setList : []
    runs.value = Array.isArray(runList) ? runList : []
  } finally {
    loading.value = false
  }
}

function notify(title: string) {
  globalThis.alert?.(title)
}

function onFilterChange() {
  void load()
}

/** 对选中评测集重跑一次评测 */
async function onRunEval() {
  const target = sets.value.find((s) => s.id === filterSet.value) ?? sets.value[0]
  if (!target) {
    notify('还没有评测集')
    return
  }
  running.value = true
  try {
    // 取一个候选 / 灰度发布作为被评对象（门禁评测只针对未生效发布）
    const releases = await request<{ id: string; status: string; prompt_version: string }[]>({
      url: '/admin/models',
    })
    const candidate = (releases ?? []).find((r) => r.status === '候选' || r.status === '灰度') ?? releases?.[0]
    if (!candidate) {
      notify('没有可评测的发布组合')
      return
    }
    await request({
      url: '/admin/eval/runs',
      method: 'POST',
      data: { model_release_id: candidate.id, eval_set_id: target.id, trigger_reason: '后台手动重跑' },
    })
    notify('评测已运行')
    await load()
  } catch (e) {
    notify(e instanceof Error ? e.message : '评测运行失败')
  } finally {
    running.value = false
  }
}

/** 指标文案 */
function metricText(m: Record<string, number>): string {
  return Object.entries(m)
    .map(([k, v]) => (k === '引用支持率' || k === '用例通过率' ? `${k} ${Math.round(v * 1000) / 10}%` : `${k} ${v}`))
    .join(' · ')
}

const selectedRun = computed<EvalRunItem | undefined>(() =>
  runs.value.find((r) => r.id === selectedRunId.value) ?? runs.value[0],
)

function onSelectRun(run: EvalRunItem) {
  selectedRunId.value = run.id
}
</script>

<template>
  <div class="eval-page">
    <!-- 评测集列表 -->
    <AppCard class="panel">
      <div class="panel__head">
        <h2 class="panel__title">评测集（来源与门禁）</h2>
        <AppButton type="primary" size="sm" :loading="running" @click="onRunEval">重跑评测</AppButton>
      </div>
      <div v-if="loading" class="panel__loading">正在加载…</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>用例数</th>
            <th>去标识化</th>
            <th>最近运行</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in sets"
            :key="s.id"
            :class="{ 'table__row--selected': filterSet === s.id }"
            @click="filterSet = s.id; onFilterChange()"
          >
            <td class="table__name">{{ s.name }}</td>
            <td>{{ s.case_count }}</td>
            <td>
              <StatusTag v-if="s.deidentified" status="confirmed" text="已去标识化" />
              <StatusTag v-else status="unconfirmed" text="未去标识化" />
            </td>
            <td>
              <StatusTag v-if="s.latest_run" :status="s.latest_run.result === '通过' ? 'confirmed' : 'conflict'" :text="s.latest_run.result" />
              <span v-else>—</span>
            </td>
            <td class="table__ops">
              <button type="button" class="op-link" @click.stop="filterSet = s.id; onFilterChange()">查看运行</button>
            </td>
          </tr>
          <tr v-if="sets.length === 0">
            <td colspan="5" class="table__empty">还没有评测集</td>
          </tr>
        </tbody>
      </table>
      <div class="panel__foot">
        <label class="filter">
          <span>评测集：</span>
          <select v-model="filterSet" @change="onFilterChange">
            <option value="全部">全部</option>
            <option v-for="s in sets" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
      </div>
    </AppCard>

    <div class="eval-grid">
      <!-- 运行记录 -->
      <AppCard class="panel">
        <h2 class="panel__title">运行记录</h2>
        <div v-if="loading" class="panel__loading">正在加载…</div>
        <table v-else class="table">
          <thead>
            <tr><th>时间</th><th>发布</th><th>评测集</th><th>触发原因</th><th>结果</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="r in runs"
              :key="r.id"
              :class="{ 'table__row--selected': selectedRun?.id === r.id }"
              @click="onSelectRun(r)"
            >
              <td class="table__time">{{ r.created_at.slice(0, 16).replace('T', ' ') }}</td>
              <td>{{ r.prompt_version }}</td>
              <td>{{ r.eval_set_name }}</td>
              <td>{{ r.trigger_reason }}</td>
              <td>
                <StatusTag :status="r.result === '通过' ? 'confirmed' : 'conflict'" :text="r.result" />
              </td>
            </tr>
            <tr v-if="runs.length === 0">
              <td colspan="5" class="table__empty">没有运行记录</td>
            </tr>
          </tbody>
        </table>
      </AppCard>

      <!-- 运行详情：指标 + 失败用例 -->
      <aside class="eval-aside">
        <AppCard v-if="selectedRun" class="panel">
          <h2 class="panel__title">运行详情 · {{ selectedRun.eval_set_name }}</h2>
          <p class="kv__row"><span>发布</span><span>{{ selectedRun.model_name }} {{ selectedRun.prompt_version }}</span></p>
          <p class="kv__row"><span>用例</span><span>通过 {{ selectedRun.passed_count }} / {{ selectedRun.case_count }} · 失败 {{ selectedRun.failed_count }}</span></p>
          <p class="kv__row"><span>指标</span><span>{{ metricText(selectedRun.metrics) }}</span></p>
          <p class="kv__row"><span>触发原因</span><span>{{ selectedRun.trigger_reason }}</span></p>
        </AppCard>

        <AppCard v-if="selectedRun && selectedRun.failed_cases.length > 0" class="panel">
          <h2 class="panel__title">失败用例（去标识化）</h2>
          <div v-for="(c, i) in selectedRun.failed_cases" :key="i" class="case">
            <p class="case__row"><span>输入</span>{{ c.input ?? '—' }}</p>
            <p class="case__row"><span>期望</span>{{ c.expected ?? '—' }}</p>
            <p class="case__row"><span>实际</span>{{ c.actual ?? '—' }}</p>
            <p class="case__row"><span>判定</span>{{ c.verdict ?? '未通过' }}</p>
          </div>
        </AppCard>

        <AppCard v-else-if="selectedRun" class="panel">
          <p class="panel__hint">本次运行没有失败用例。</p>
        </AppCard>
      </aside>
    </div>

    <AppNotice type="info">
      评测集与用例全部去标识化（手机号 138****1234、姓名「用户」）；门禁未通过（任一类别失败 &gt; 0）时阻断发布。
    </AppNotice>
  </div>
</template>

<style scoped>
.eval-page {
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

.panel__title {
  margin: 0;
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

.panel__foot {
  display: flex;
  justify-content: flex-end;
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
  vertical-align: top;
}

.table tbody tr {
  cursor: pointer;
}

.table tbody tr:hover td {
  background: var(--color-bg);
}

.table__row--selected td {
  background: var(--color-primary-light);
}

.table__name {
  font-weight: var(--font-weight-medium);
}

.table__time {
  white-space: nowrap;
  color: var(--color-text-2);
}

.table__ops {
  white-space: nowrap;
}

.table__empty {
  text-align: center;
  color: var(--color-text-3);
  padding: var(--spacing-xl);
}

.op-link {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

/* ---------- 布局 ---------- */
.eval-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.eval-aside {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  min-width: 0;
}

.kv__row {
  margin: 0;
  display: flex;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-aux-sm);
}

.kv__row:first-child {
  border-top: none;
}

.kv__row span:first-child {
  min-width: 72px;
  color: var(--color-text-2);
}

.kv__row span:last-child {
  flex: 1;
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

/* ---------- 失败用例 ---------- */
.case {
  padding: var(--spacing-sm);
  background: var(--color-error-light);
  border-radius: var(--radius-button);
  margin-bottom: var(--spacing-sm);
}

.case__row {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.case__row span {
  display: inline-block;
  min-width: 40px;
  color: var(--color-text-2);
}

@media (max-width: 1200px) {
  .eval-grid {
    grid-template-columns: 1fr;
  }
}
</style>
