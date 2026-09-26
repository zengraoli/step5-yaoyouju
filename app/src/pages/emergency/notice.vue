<script setup lang="ts">
/**
 * A03 就医提示（设计稿 docs/design/app/A03.png，设计宽度 375）
 *
 * 产品红线：
 * - 命中红旗信号时立即展示本页，不被登录、付费、上传或长问卷阻断；
 * - 本轮不生成个性化分析，不作诊断；
 * - 本页始终可达：内容优先来自 server 公开接口 GET /safety/emergency-notice，
 *   网络异常时展示静态兜底内容（就医提示不被网络阻断）。
 *
 * 数据来源：
 * - GET /safety/emergency-notice（公开，无需登录）：提示标题 / 动作 / 脚注等固定内容；
 * - 命中的红旗信号：从 A02 跳转时通过页面参数传入（signals / stop / rule），
 *   其内容来自 POST /analyses 命中红旗的 409 响应 data.matched，或本地从用户选择推导；
 * - 「就诊时可以带上」三条：来自当前用户病程数据（GET /episodes、GET /episodes/{id}），
 *   有则打勾，无则显示「尚未确认」，不默认为有。
 */
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import { useAuthStore } from '../../stores/auth'
import { getEmergencyNotice, type EmergencyNotice } from '../../api/safety'
import { getEpisode, listEpisodes, type CareEventView, type EpisodeDetail } from '../../api/episodes'
import { beijingDate, getStatusBarHeight } from '../../utils/system'

/** 网络异常时的静态兜底内容（与接口返回一致的演示文案；本页不被网络阻断） */
const FALLBACK: EmergencyNotice = {
  title: '需要及时寻求专业帮助',
  headline: '建议尽快就医',
  body: '你刚才选择了需要医生及时评估的变化。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。',
  offline_note: '本页在网络异常时也可查看。',
  actions: [
    { type: 'call', label: '拨打 120 / 前往急诊' },
    { type: 'hospital', label: '查找附近医院' },
    { type: 'doctor', label: '联系我的主治医生（已保存）' },
  ],
  bring_list: ['已录入的检查报告原文', '症状开始时间与最近变化记录', '正在使用的药物与既有医嘱'],
  summary_action: { label: '生成一页“就诊交接”摘要（仅整理已有信息）' },
  footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
}

/** 「就诊时可以带上」的一条 */
interface BringItem {
  key: string
  label: string
  /** 动态补充（如报告的日期与类型），有才展示 */
  detail: string
  /** 是否已有对应资料；无则显示「尚未确认」 */
  available: boolean
}

const BRING_LABELS = {
  report: '已录入的检查报告原文',
  onset: '症状开始时间与最近变化记录',
  medication: '正在使用的药物与既有医嘱',
} as const

const auth = useAuthStore()
const statusBarHeight = ref(0)

/** 页面内容：先展示兜底内容，接口返回后替换（本页始终可达） */
const notice = ref<EmergencyNotice>(FALLBACK)
/** 命中的红旗信号（A02 通过页面参数传入；没有时为空，用接口返回的正文） */
const signals = ref<string[]>([])
/** 是否命中 high 级红旗（停止个性化分析） */
const stopPersonal = ref(false)
/** 命中的规则集版本（来源可见） */
const ruleVersion = ref('')
/** 就诊可带资料：默认全部「尚未确认」，取到病程数据后更新 */
const bringItems = ref<BringItem[]>(
  (Object.keys(BRING_LABELS) as (keyof typeof BRING_LABELS)[]).map((key) => ({
    key,
    label: BRING_LABELS[key],
    detail: '',
    available: false,
  })),
)

onLoad((options) => {
  const raw = typeof options?.signals === 'string' ? options.signals : ''
  signals.value = raw ? raw.split('、').filter((text) => text.length > 0) : []
  stopPersonal.value = options?.stop === '1'
  const rule = typeof options?.rule === 'string' ? options.rule : ''
  ruleVersion.value = rule
})

onMounted(() => {
  statusBarHeight.value = getStatusBarHeight()
  loadNotice()
  loadBringItems()
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/** 提示内容：公开接口，失败时保留兜底内容（就医提示不被网络阻断） */
async function loadNotice() {
  try {
    notice.value = await getEmergencyNotice()
  } catch {
    notice.value = FALLBACK
  }
}

/** 就诊可带资料：来自当前用户病程；未登录或接口异常时全部显示「尚未确认」 */
async function loadBringItems() {
  const unconfirmed = (): BringItem[] =>
    (Object.keys(BRING_LABELS) as (keyof typeof BRING_LABELS)[]).map((key) => ({
      key,
      label: BRING_LABELS[key],
      detail: '',
      available: false,
    }))
  if (!auth.isLoggedIn) {
    bringItems.value = unconfirmed()
    return
  }
  try {
    const list = await listEpisodes()
    const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
    if (!active) {
      bringItems.value = unconfirmed()
      return
    }
    bringItems.value = buildBringItems(await getEpisode(active.id))
  } catch {
    bringItems.value = unconfirmed()
  }
}

/** 按病程数据生成三条「就诊时可以带上」（缺失不默认阳性） */
function buildBringItems(detail: EpisodeDetail): BringItem[] {
  const events = detail.events ?? []
  const latestReport = events.find((e) => e.event_type === '报告')
  const symptomCount = events.filter((e) => e.event_type === '症状').length
  const latestAdvice = events.find((e) => e.event_type === '医嘱')
  return [
    {
      key: 'report',
      label: BRING_LABELS.report,
      detail: latestReport ? `（${reportMetaOf(latestReport)}）` : '',
      available: Boolean(latestReport),
    },
    {
      key: 'onset',
      label: BRING_LABELS.onset,
      detail: detail.onset_date ? `（${detail.onset_date} 起，共 ${symptomCount} 条症状记录）` : '',
      available: Boolean(detail.onset_date) && symptomCount > 0,
    },
    {
      key: 'medication',
      label: BRING_LABELS.medication,
      detail: latestAdvice ? `（最近医嘱：${beijingDate(latestAdvice.occurred_at)}）` : '',
      available: Boolean(latestAdvice),
    },
  ]
}

/** 最新报告的日期与类型（动态来自该用户的报告，不写死） */
function reportMetaOf(event: CareEventView): string {
  const date = event.report?.report_date || beijingDate(event.occurred_at) || '日期尚未确认'
  const head = (event.raw_text ?? '').split(/[：（(]/)[0].trim()
  return `${date} ${head || '检查报告'}`
}

/* ---------- 派生展示 ---------- */

const noticeTitle = computed(() => notice.value.title || FALLBACK.title)

const headline = computed(() => {
  if (signals.value.length === 0) return notice.value.headline || FALLBACK.headline
  return stopPersonal.value ? '建议尽快就医' : '建议及时就医评估'
})

/** 正文：命中的信号列表动态填充；未带信号时用接口返回的正文 */
const bodyText = computed(() => {
  if (signals.value.length === 0) return notice.value.body || FALLBACK.body
  const joined = signals.value.join('、')
  return stopPersonal.value
    ? `你刚才选择了：${joined}。这类变化需要医生及时评估，本产品无法替你判断严重程度，本轮不会生成个性化分析。`
    : `你刚才选择了：${joined}。这类变化需要医生及时评估，本产品无法替你判断严重程度；个性化分析仍会生成，请以医生的评估为准。`
})

const callAction = computed(
  () => notice.value.actions.find((a) => a.type === 'call') ?? FALLBACK.actions[0],
)
const hospitalAction = computed(
  () => notice.value.actions.find((a) => a.type === 'hospital') ?? FALLBACK.actions[1],
)
const doctorAction = computed(
  () => notice.value.actions.find((a) => a.type === 'doctor') ?? FALLBACK.actions[2],
)

/* ---------- 交互 ---------- */
/** 拨打 120 / 前往急诊（演示环境不真正拨号时给出提示） */
function onCall() {
  uni.makePhoneCall({
    phoneNumber: '120',
    fail: () => toast('演示环境：请拨打 120 或前往最近的医院急诊'),
  })
}

function onHospital() {
  toast('演示环境：将打开地图查找附近医院')
}

function onDoctor() {
  toast('演示环境：主治医生联系方式已保存在就诊资料中')
}

/** 生成一页「就诊交接」摘要（仅整理已有信息）→ 复诊摘要页（T23 占位） */
function onSummary() {
  toast('就诊交接摘要仅整理已有信息，将在复诊准备中生成')
  uni.reLaunch({ url: '/pages/followup/index' })
}

/** 我已知晓：继续查看已审核科普与复诊摘要 */
function onAcknowledged() {
  toast('已审核科普库将在后续版本开放，先进入复诊摘要')
  uni.reLaunch({ url: '/pages/followup/index' })
}

function onBack() {
  uni.navigateBack({
    fail: () => {
      uni.reLaunch({ url: '/pages/index/index' })
    },
  })
}
</script>

<template>
  <view class="page notice-page">
    <!-- 自定义导航栏（返回 + 标题） -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">{{ noticeTitle }}</text>
      </view>
    </view>

    <view class="notice-body">
      <!-- 红色警示卡：命中的信号列表由接口 / 页面参数动态填充 -->
      <view class="alert-card">
        <view class="alert-card__head">
          <AppIcon class="alert-card__icon" name="alert" :size="22" />
          <text class="alert-card__headline">{{ headline }}</text>
        </view>
        <text class="alert-card__body">{{ bodyText }}</text>
        <view class="gap-sm" />
        <text class="alert-card__offline">{{ notice.offline_note || FALLBACK.offline_note }}</text>
      </view>

      <view class="gap-md" />

      <!-- 主按钮：拨打 120 / 前往急诊 -->
      <AppButton type="danger" block icon="phone" @click="onCall">{{ callAction.label }}</AppButton>

      <view class="gap-sm" />

      <!-- 次按钮：查找附近医院 / 联系主治医生 -->
      <AppButton type="secondary" block icon="location" @click="onHospital">
        {{ hospitalAction.label }}
      </AppButton>
      <view class="gap-sm" />
      <AppButton type="secondary" block icon="user" @click="onDoctor">
        {{ doctorAction.label }}
      </AppButton>

      <view class="gap-md" />

      <!-- 就诊时可以带上：有则打勾，无则显示「尚未确认」 -->
      <AppCard title="就诊时可以带上">
        <view v-for="item in bringItems" :key="item.key" class="bring-item">
          <AppIcon v-if="item.available" class="bring-item__check" name="check" :size="16" />
          <StatusTag v-else status="unconfirmed" text="尚未确认" />
          <text class="bring-item__label">
            {{ item.label }}<text v-if="item.detail" class="bring-item__detail">{{ item.detail }}</text>
          </text>
        </view>
      </AppCard>

      <view class="gap-md" />

      <!-- 生成一页「就诊交接」摘要（仅整理已有信息） -->
      <AppButton type="soft" block icon="file" @click="onSummary">
        {{ notice.summary_action.label || FALLBACK.summary_action.label }}
      </AppButton>

      <view class="gap-md" />

      <!-- 信息来源与免责 -->
      <AppNotice type="info">
        {{ notice.footer_note || FALLBACK.footer_note }}
      </AppNotice>
      <view v-if="ruleVersion" class="gap-sm" />
      <text v-if="ruleVersion" class="aux-text">规则集版本：{{ ruleVersion }}（临床审定规则）</text>

      <view class="gap-xl" />

      <!-- 底部文字按钮 -->
      <view class="acknowledge" hover-class="acknowledge--hover" :hover-stay-time="80" @click="onAcknowledged">
        <text class="acknowledge__text">我已知晓，继续查看已审核科普与复诊摘要</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.notice-page {
  padding: 0;
  background-color: $color-bg;
}

/* ---------- 自定义导航栏（白底） ---------- */
.nav {
  background-color: $color-surface;
  padding: 0 $spacing-page $spacing-sm;
}

.nav__bar {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.nav__back {
  flex: none;
  width: 64rpx;
  height: 80rpx;
  margin-left: -16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-text-1;
}

.nav__back--hover {
  opacity: 0.6;
}

.nav__title {
  flex: 1;
  min-width: 0;
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.4;
}

.notice-body {
  padding: $spacing-md $spacing-page $spacing-xxl;
}

/* ---------- 红色警示卡 ---------- */
.alert-card {
  padding: $spacing-md;
  border-radius: $radius-card;
  background-color: $color-error-light;
}

.alert-card__head {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.alert-card__icon {
  flex: none;
  color: $color-error;
}

.alert-card__headline {
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-error;
  line-height: 1.4;
}

.alert-card__body {
  display: block;
  margin-top: $spacing-sm;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.alert-card__offline {
  display: block;
  font-size: $font-size-aux;
  color: $color-text-3;
  line-height: 1.5;
}

/* ---------- 就诊时可以带上 ---------- */
.bring-item {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;

  & + & {
    margin-top: $spacing-sm;
  }
}

.bring-item__check {
  flex: none;
  margin-top: 4rpx;
  color: $color-ok;
}

.bring-item__label {
  flex: 1;
  min-width: 0;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: 1.5;
}

.bring-item__detail {
  color: $color-text-2;
}

/* ---------- 底部文字按钮 ---------- */
.acknowledge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 88rpx;
  padding: $spacing-sm 0;
}

.acknowledge--hover {
  opacity: 0.7;
}

.acknowledge__text {
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  color: $color-primary;
  line-height: 1.5;
  text-align: center;
}
</style>
