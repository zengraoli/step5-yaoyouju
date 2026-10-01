<script setup lang="ts">
/**
 * 就医提示（R03，公开页，无需登录；内容来自 server 公开接口）
 * 网络异常时展示静态兜底内容（就医提示不被网络阻断）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppNotice from '@/components/AppNotice.vue'
import { getEmergencyNotice } from '@/api/safety'
import { getEpisode, listEpisodes } from '@/api/episodes'
import { beijingDate } from '@/utils/date'
import { STORAGE_KEYS } from '@/utils/constants'

interface EmergencyNotice {
  title: string
  headline: string
  body: string
  offline_note: string
  matched?: { label: string }[]
  actions: { type: string; label: string }[]
  bring_list: string[]
  summary_action: { label: string }
  footer_note: string
}

/** 网络异常时的静态兜底内容（就医提示不被网络阻断） */
const FALLBACK: EmergencyNotice = {
  title: '需要及时寻求专业帮助',
  headline: '建议尽快就医',
  body: '你刚才选择了需要医生及时评估的变化。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。',
  offline_note: '本页在网络异常时也可查看。',
  actions: [
    { type: 'call', label: '拨打 120 / 前往急诊' },
    { type: 'hospital', label: '查找附近医院' },
    { type: 'doctor', label: '联系我的主治医生' },
  ],
  bring_list: ['已录入的检查报告原文', '症状开始时间与最近变化记录', '正在使用的药物与既有医嘱'],
  summary_action: { label: '生成一页“就诊交接”摘要（仅整理已有信息）' },
  footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
}

const notice = ref<EmergencyNotice>(FALLBACK)
const route = useRoute()

/** 命中的红旗信号（从问答 / 记录今天 / 建立病程跳转时带入） */
const signals = computed<string[]>(() => {
  const raw = String(route.query.signals ?? '')
  return raw ? raw.split(/[、,，]/).filter((t) => t.length > 0) : []
})
const stopPersonal = computed(() => route.query.stop === '1')

/** 就诊可带资料：按当前用户病程数据展示，没有就不打勾（不写死任何报告） */
const bringItems = ref<{ key: string; label: string; detail: string; available: boolean }[]>([])

onMounted(async () => {
  try {
    notice.value = await getEmergencyNotice(signals.value, stopPersonal.value)
  } catch {
    notice.value = FALLBACK
  }
  await loadBringItems()
})

async function loadBringItems() {
  const base = (notice.value.bring_list ?? FALLBACK.bring_list).map((label, i) => ({
    key: String(i),
    label,
    detail: '',
    available: false,
  }))
  // 未登录时不请求病程接口：就医提示不被登录阻断，也不产生 401 噪音
  const token = localStorage.getItem(STORAGE_KEYS.token)
  if (!token) {
    bringItems.value = base
    return
  }
  try {
    const episodes = await listEpisodes()
    const active = episodes.find((e) => e.status === '进行中') ?? episodes[0] ?? null
    if (!active) {
      bringItems.value = base
      return
    }
    const detail = await getEpisode(active.id)
    const events = detail.events ?? []
    const report = events.find((e) => e.event_type === '报告')
    const symptomCount = events.filter((e) => e.event_type === '症状').length
    const advice = events.find((e) => e.event_type === '医嘱')
    bringItems.value = base.map((item, i) => {
      if (i === 0 && report) {
        const date = report.report?.report_date ?? detail.onset_date ?? ''
        return { ...item, detail: date ? `（${date} 检查报告）` : '', available: true }
      }
      if (i === 1 && detail.onset_date && symptomCount > 0) {
        return { ...item, detail: `（${detail.onset_date} 起，共 ${symptomCount} 条症状记录）`, available: true }
      }
      if (i === 2 && advice) {
        return { ...item, detail: `（最近医嘱：${beijingDate(advice.occurred_at)}）`, available: true }
      }
      return item
    })
  } catch {
    bringItems.value = base
  }
}

/** 拨打 120（演示环境不真正拨号） */
function onCall() {
  toast('演示环境不会真正拨号，请用手机拨打 120 或前往急诊')
}

/** 查找附近医院（演示环境给出说明） */
function onHospital() {
  toast('演示环境未接入地图，请用手机地图搜索「附近的医院」')
}

function toast(title: string) {
  window.alert(title)
}
</script>

<template>
  <div class="emergency-page">
    <div class="emergency-card">
      <h1 class="emergency-card__title">{{ notice.title }}</h1>
      <div class="emergency-card__hero">
        <h2>{{ notice.headline }}</h2>
        <p>{{ notice.body }}</p>
        <p class="emergency-card__offline">{{ notice.offline_note }}</p>
      </div>
      <div class="emergency-card__actions">
        <button
          v-for="a in notice.actions"
          :key="a.type"
          type="button"
          class="emergency-action"
          :class="`emergency-action--${a.type}`"
          @click="a.type === 'call' ? onCall() : a.type === 'hospital' ? onHospital() : undefined"
        >
          {{ a.label }}
        </button>
      </div>
      <section class="emergency-card__section">
        <h3>就诊时可以带上</h3>
        <ul>
          <li v-for="item in bringItems" :key="item.key">
            <span class="emergency-card__check" :class="{ 'is-available': item.available }">{{ item.available ? '✓' : '○' }}</span>
            {{ item.label }}<span v-if="item.detail" class="emergency-card__detail">{{ item.detail }}</span>
            <span v-if="!item.available" class="emergency-card__pending">（尚未确认）</span>
          </li>
        </ul>
      </section>
      <AppNotice type="info">{{ notice.footer_note }}</AppNotice>
    </div>
  </div>
</template>

<style scoped>
.emergency-page {
  max-width: 720px;
  margin: 0 auto;
}

.emergency-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--spacing-xxl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.emergency-card__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.emergency-card__hero {
  background: var(--color-error-light);
  border-radius: var(--radius-card);
  padding: var(--spacing-lg);
}

.emergency-card__hero h2 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
  color: var(--color-error);
}

.emergency-card__hero p {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.emergency-card__offline {
  color: var(--color-text-2);
  font-size: var(--font-size-aux-sm);
}

.emergency-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.emergency-action {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-button);
  font-size: var(--font-size-body);
  text-decoration: none;
}

.emergency-action--call {
  background: var(--color-error);
  color: var(--color-surface);
}

.emergency-action--hospital,
.emergency-action--doctor {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-1);
}

.emergency-card__section h3 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--font-size-card-title);
}

.emergency-card__section ul {
  margin: 0;
  padding-left: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  font-size: var(--font-size-body);
  color: var(--color-text-2);
}
</style>
