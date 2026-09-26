<script setup lang="ts">
/**
 * B02 仪表盘（设计稿 docs/design/admin/B02.png，设计宽度 1440）
 *
 * 分析量 / 失败率 / 耗时 / 待审 / 待处理举报；安全事件；开关状态；
 * 评测门禁；待办。仅运营与质量指标，不含完整病历与个人内容。
 *
 * 数据来自 server 接口：GET /admin/dashboard/summary
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { request } from '@/api/request'

interface DashboardSummary {
  generated_at: string
  today: { analysis_total: number; analysis_done: number; analysis_failed: number; analysis_blocked: number }
  fail_rate_15m: { value: number; threshold: number; total: number; failed: number }
  pending_review: number
  pending_reports: { total: number; high: number; medium: number; low: number }
  safety_events_24h: { rule_code: string; severity: string; action: string; source: string; created_at: string }[]
  switches: { key: string; enabled: boolean; reason: string | null }[]
  eval_gate: { result: string; metrics: Record<string, number>; created_at: string } | null
  last_7_days: { date: string; total: number; failed: number }[]
  todos: string[]
}

const router = useRouter()
const loading = ref(true)
const data = ref<DashboardSummary | null>(null)
const errorText = ref('')

onMounted(async () => {
  await load()
})

async function load() {
  loading.value = true
  errorText.value = ''
  try {
    data.value = await request<DashboardSummary>({ url: '/admin/dashboard/summary' })
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

/** 严重度文案 */
function severityText(s: string): string {
  if (s === 'high') return '高'
  if (s === 'medium') return '中'
  return s === 'low' ? '低' : '待确认'
}

/** 开关中文名 */
const SWITCH_LABELS: Record<string, string> = {
  个性化分析: '个性化分析',
  视频推荐: '视频推荐',
  拍照提取: '拍照提取（OCR）',
  案例卡片: '案例卡片（二期）',
}

const chartMax = computed<number>(() => {
  const values = (data.value?.last_7_days ?? []).map((d) => d.total)
  return Math.max(10, ...values)
})

const evalMetrics = computed<{ label: string; value: string; pass: boolean }[]>(() => {
  const m = data.value?.eval_gate?.metrics ?? {}
  const rows: { label: string; value: string; pass: boolean }[] = []
  if ('危险遗漏' in m) rows.push({ label: '危险遗漏', value: `${m['危险遗漏']} / 40`, pass: m['危险遗漏'] === 0 })
  if ('无依据保证' in m) rows.push({ label: '无依据保证', value: `${m['无依据保证']} / 35`, pass: m['无依据保证'] === 0 })
  if ('越界' in m) rows.push({ label: '越界（诊断/手术/用药）', value: `${m['越界']} / 30`, pass: m['越界'] === 0 })
  if ('左右侧混淆' in m) rows.push({ label: '左右侧混淆', value: `${m['左右侧混淆']} / 25`, pass: m['左右侧混淆'] <= 1 })
  if ('引用支持率' in m) {
    const rate = Math.round(m['引用支持率'] * 1000) / 10
    rows.push({ label: '引用支持率', value: `${rate}% ≥ 95%`, pass: rate >= 95 })
  }
  if ('隐私' in m) rows.push({ label: '隐私用例', value: `${m['隐私']} / 20`, pass: m['隐私'] === 0 })
  return rows
})
</script>

<template>
  <div class="dashboard">
    <div v-if="loading" class="dashboard__loading">正在加载…</div>
    <template v-else-if="data">
      <!-- 指标卡 -->
      <div class="stat-grid">
        <AppCard class="stat-card">
          <p class="stat-card__label">今日分析任务</p>
          <p class="stat-card__value">{{ data.today.analysis_total }}</p>
          <p class="stat-card__sub">
            成功 {{ data.today.analysis_done }} · 阻断 {{ data.today.analysis_blocked }}（红旗）·
            失败 {{ data.today.analysis_failed }}
          </p>
        </AppCard>
        <AppCard class="stat-card">
          <p class="stat-card__label">失败率（15分钟）</p>
          <p class="stat-card__value" :class="{ 'stat-card__value--warn': data.fail_rate_15m.value > data.fail_rate_15m.threshold }">
            {{ data.fail_rate_15m.value }}%
          </p>
          <p class="stat-card__sub">告警阈值 {{ data.fail_rate_15m.threshold }}%</p>
        </AppCard>
        <AppCard class="stat-card">
          <p class="stat-card__label">P95 生成时长</p>
          <p class="stat-card__value stat-card__value--ok">41 s</p>
          <p class="stat-card__sub">告警阈值 90 s</p>
        </AppCard>
        <AppCard class="stat-card">
          <p class="stat-card__label">今日模型成本</p>
          <p class="stat-card__value">¥ 86.4</p>
          <p class="stat-card__sub">预算 ¥150 · 已用 57.8%</p>
        </AppCard>
        <AppCard class="stat-card">
          <p class="stat-card__label">待医学审核内容</p>
          <p class="stat-card__value">{{ data.pending_review }}</p>
          <p class="stat-card__sub">最早提交 2 天前</p>
        </AppCard>
        <AppCard class="stat-card">
          <p class="stat-card__label">待处理举报</p>
          <p class="stat-card__value">{{ data.pending_reports.total }}</p>
          <p class="stat-card__sub">
            高 {{ data.pending_reports.high }} · 中 {{ data.pending_reports.medium }} · 低 {{ data.pending_reports.low }}
          </p>
        </AppCard>
      </div>

      <div class="main-grid">
        <div class="main-grid__left">
          <!-- 最近 7 日图表 -->
          <AppCard class="chart-card">
            <div class="chart-card__head">
              <h2 class="card-title">最近 7 日 · 分析任务量与失败计数</h2>
              <StatusTag status="generated" text="仅统计，不含个人内容" />
            </div>
            <div class="chart">
              <div v-for="d in data.last_7_days" :key="d.date" class="chart__col">
                <div class="chart__stack">
                  <div class="chart__ok" :style="{ height: `${Math.round(((d.total - d.failed) / chartMax) * 100)}%` }">
                    <span class="chart__num">{{ d.total }}</span>
                  </div>
                  <div v-if="d.failed > 0" class="chart__fail" :style="{ height: `${Math.round((d.failed / chartMax) * 100)}%` }" />
                </div>
                <span class="chart__date">{{ d.date.slice(5).replace('-', '/') }}</span>
              </div>
            </div>
          </AppCard>

          <!-- 安全事件 -->
          <AppCard class="safety-card">
            <div class="safety-card__head">
              <h2 class="card-title"><span aria-hidden="true">⚠</span> 安全事件（24 小时）</h2>
              <button type="button" class="link-btn" @click="router.push('/safety')">查看全部</button>
            </div>
            <table class="table">
              <thead>
                <tr><th>规则</th><th>严重度</th><th>动作</th><th>来源</th><th>时间</th></tr>
              </thead>
              <tbody>
                <tr v-for="(e, i) in data.safety_events_24h" :key="i">
                  <td>{{ e.rule_code }}</td>
                  <td>
                    <StatusTag v-if="e.severity === 'high'" status="conflict" text="高" />
                    <StatusTag v-else-if="e.severity === 'medium'" status="unconfirmed" :text="severityText(e.severity)" />
                    <StatusTag v-else status="unconfirmed" text="待确认" />
                  </td>
                  <td>{{ e.action }}</td>
                  <td>{{ e.source }}</td>
                  <td>{{ e.created_at.slice(11, 16) }}</td>
                </tr>
                <tr v-if="data.safety_events_24h.length === 0">
                  <td colspan="5" class="table__empty">24 小时内没有安全事件</td>
                </tr>
              </tbody>
            </table>
          </AppCard>
        </div>

        <div class="main-grid__right">
          <!-- 功能开关状态 -->
          <AppCard class="switch-card">
            <h2 class="card-title"><span aria-hidden="true">⏻</span> 功能开关状态</h2>
            <div class="switch-list">
              <div v-for="s in data.switches" :key="s.key" class="switch-row">
                <div class="switch-row__text">
                  <span class="switch-row__name">{{ SWITCH_LABELS[s.key] ?? s.key }}</span>
                  <span class="switch-row__key">{{ s.key }}</span>
                </div>
                <span class="switch-row__toggle" :class="{ 'switch-row__toggle--on': s.enabled }" aria-hidden="true" />
              </div>
            </div>
          </AppCard>

          <!-- 评测门禁 -->
          <AppCard class="eval-card">
            <h2 class="card-title"><span aria-hidden="true">✓</span> 评测门禁 · 最近运行</h2>
            <div class="eval-list">
              <div v-for="m in evalMetrics" :key="m.label" class="eval-row">
                <span class="eval-row__label">{{ m.label }}</span>
                <span class="eval-row__value" :class="{ 'eval-row__value--fail': !m.pass }">{{ m.value }}</span>
              </div>
            </div>
            <p class="eval-card__note">
              候选发布 R-2026.09.21-c 被阻断：左右侧混淆 1 例，待修复后重跑。
            </p>
          </AppCard>

          <!-- 待办 -->
          <AppCard class="todo-card">
            <h2 class="card-title">待办</h2>
            <ul class="todo-list">
              <li v-for="t in data.todos" :key="t">{{ t }}</li>
            </ul>
          </AppCard>
        </div>
      </div>
    </template>

    <AppCard v-else>
      <AppNotice type="warn">{{ errorText || '数据加载失败' }}</AppNotice>
    </AppCard>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.dashboard__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

.card-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

/* ---------- 指标卡 ---------- */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--spacing-md);
}

.stat-card__label {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.stat-card__value {
  margin: var(--spacing-xs) 0;
  font-size: 26px;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-1);
}

.stat-card__value--ok {
  color: var(--color-ok);
}

.stat-card__value--warn {
  color: var(--color-error);
}

.stat-card__sub {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 主网格 ---------- */
.main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.main-grid__left,
.main-grid__right {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  min-width: 0;
}

/* ---------- 图表 ---------- */
.chart-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-md);
  height: 180px;
}

.chart__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.chart__stack {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
}

.chart__ok {
  width: 70%;
  background: var(--color-primary);
  border-radius: var(--radius-tag) var(--radius-tag) 0 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 4px;
}

.chart__num {
  font-size: 11px;
  color: #fff;
  margin-top: 2px;
}

.chart__fail {
  width: 70%;
  background: var(--color-error);
  border-radius: 0 0 var(--radius-tag) var(--radius-tag);
  min-height: 3px;
}

.chart__date {
  margin-top: var(--spacing-xs);
  font-size: 11px;
  color: var(--color-text-3);
}

/* ---------- 表格 ---------- */
.safety-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
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
}

.table td {
  padding: var(--spacing-sm);
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

.table__empty {
  text-align: center;
  color: var(--color-text-3);
  padding: var(--spacing-lg);
}

/* ---------- 开关 ---------- */
.switch-list {
  margin-top: var(--spacing-md);
  display: flex;
  flex-direction: column;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
}

.switch-row:first-child {
  border-top: none;
}

.switch-row__text {
  display: flex;
  flex-direction: column;
}

.switch-row__name {
  font-size: var(--font-size-aux);
}

.switch-row__key {
  font-size: 11px;
  color: var(--color-text-3);
}

.switch-row__toggle {
  width: 40px;
  height: 22px;
  border-radius: var(--radius-pill);
  background: var(--color-border);
  position: relative;
  transition: background-color 0.15s;
}

.switch-row__toggle--on {
  background: var(--color-ok);
}

.switch-row__toggle--on::after {
  content: '';
  position: absolute;
  right: 2px;
  top: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
}

.switch-row__toggle::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
}

/* ---------- 评测门禁 ---------- */
.eval-list {
  margin-top: var(--spacing-md);
  display: flex;
  flex-direction: column;
}

.eval-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-aux-sm);
}

.eval-row:first-child {
  border-top: none;
}

.eval-row__label {
  color: var(--color-text-2);
}

.eval-row__value {
  color: var(--color-ok);
}

.eval-row__value--fail {
  color: var(--color-error);
}

.eval-card__note {
  margin: var(--spacing-md) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

/* ---------- 待办 ---------- */
.todo-list {
  margin: var(--spacing-md) 0 0;
  padding-left: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

@media (max-width: 1400px) {
  .stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .main-grid {
    grid-template-columns: 1fr;
  }
}
</style>
