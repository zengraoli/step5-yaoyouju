<script setup lang="ts">
/**
 * A14 首页 · 当前情况（设计稿 docs/design/app/A14.png，宽度 375，主 Tab）
 *
 * 结构：自定义顶栏（标题 + 病程摘要 + 通知 / 头像）→ 待确认项卡片（优先）→
 *       最新一页分析摘要 → 快捷入口 2×2 → 复诊倒计时 → 为你推荐 → 就医提示条。
 *
 * 数据全部来自 server 接口，不写死在页面里：
 * - GET /episodes                    取第一个进行中的病程
 * - GET /episodes/{id}               病程事件（待确认项 / 已知 / 未知 / 下一步 / 复诊倒计时）
 * - GET /episodes/{id}/today         今天是否已记录（未记录显示「记录今天」入口）
 * - PATCH /episodes/{id}/events/{id} 内联确认（verify_status = 已确认）
 * - GET /episodes/{id}/followup      最近一份复诊摘要（待确认问题计数）
 * - GET /contents                    内容推荐（含服务端推荐理由）
 * - POST /analyses                   生成一页分析
 *
 * 产品红线：
 * - 缺失信息显示「尚未确认」，不默认阴性 / 无；
 * - 就医提示入口在页面内可达，不被登录阻断；
 * - 社区不占首屏（本页不放社区入口）；
 * - 系统生成内容带「系统生成」标记，不标为事实来源。
 */
import { computed, onMounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import EmergencyEntry from '../../components/EmergencyEntry.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { useAuthStore } from '../../stores/auth'
import {
  confirmEvent,
  createEpisode,
  getEpisode,
  getTodayStatus,
  listEpisodes,
  type CareEventView,
  type EpisodeDetail,
  type TodayStatus,
} from '../../api/episodes'
import { createAnalysis } from '../../api/analyses'
import { getLatestFollowup, QUESTIONS_SECTION_KEY } from '../../api/followup'
import { listContents, type ContentListItem } from '../../api/contents'
import {
  addToDate,
  beijingDate,
  daysFromToday,
  excerpt,
  getStatusBarHeight,
  parseCountToken,
  relativeDayLabel,
  weeksSince,
} from '../../utils/system'

/** 快捷入口（图标与文案按 A14 设计稿） */
const QUICK_ICONS = ['edit', 'upload', 'chat', 'clipboard'] as const
type QuickIcon = (typeof QUICK_ICONS)[number]

interface QuickEntry {
  key: string
  title: string
  desc: string
  icon: QuickIcon
  onClick: () => void
}

/** 医嘱里的复查间隔，如「两周后复查」「4 周后复诊」「10 天后复查」 */
const REVISIT_RE = /(\d+|[零一二两三四五六七八九十]+)\s*(周|个月|月|天)后?.{0,8}(复查|复诊|随访)/

const auth = useAuthStore()

const loading = ref(true)
const generating = ref(false)
const creating = ref(false)
const confirmingId = ref('')
const errorText = ref('')
const pendingDismissed = ref(false)

const episode = ref<EpisodeDetail | null>(null)
const today = ref<TodayStatus | null>(null)
const recommends = ref<ContentListItem[]>([])
const followupQuestions = ref<number | null>(null)

const statusBarHeight = ref(0)

onMounted(() => {
  statusBarHeight.value = getStatusBarHeight()
  load()
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/** 载入首页数据：任一接口失败只提示，不阻断其余内容 */
async function load() {
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const list = await listEpisodes()
    const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
    if (!active) {
      episode.value = null
      return
    }
    episode.value = await getEpisode(active.id)
    await Promise.all([loadToday(active.id), loadFollowup(active.id), loadRecommends()])
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '数据加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function loadToday(episodeId: string) {
  try {
    today.value = await getTodayStatus(episodeId)
  } catch {
    today.value = null
  }
}

async function loadFollowup(episodeId: string) {
  try {
    const summary = await getLatestFollowup(episodeId)
    const section = summary.content.sections.find((s) => s.key === QUESTIONS_SECTION_KEY)
    followupQuestions.value = section ? section.items.length : 0
  } catch {
    // 还没有生成过复诊摘要：不报错，快捷入口展示默认说明
    followupQuestions.value = null
  }
}

async function loadRecommends() {
  try {
    recommends.value = await listContents()
  } catch {
    recommends.value = []
  }
}

/* ---------- 派生数据 ---------- */

const events = computed<CareEventView[]>(() => episode.value?.events ?? [])

/** 病程中尚未确认的事件（产品红线：缺失不默认阴性） */
const unconfirmedEvents = computed<CareEventView[]>(() =>
  events.value.filter((e) => e.verify_status === '尚未确认'),
)

/** 今天是否还没记录（不复用昨日答案，未记录则给「记录今天」入口） */
const todayNotLogged = computed(() => Boolean(today.value) && !today.value?.logged)

interface PendingItem {
  key: string
  text: string
  kind: 'event' | 'today'
  eventId?: string
}

const pendingItems = computed<PendingItem[]>(() => {
  const items: PendingItem[] = unconfirmedEvents.value.map((e) => ({
    key: e.id,
    kind: 'event' as const,
    eventId: e.id,
    text: eventText(e),
  }))
  if (todayNotLogged.value) {
    items.push({ key: 'today', kind: 'today' as const, text: '今天还没有记录，可跳过，不默认「无」' })
  }
  return items
})

const showPending = computed(() => pendingItems.value.length > 0 && !pendingDismissed.value)

const pendingTitle = computed(() =>
  unconfirmedEvents.value.length > 0
    ? `有 ${unconfirmedEvents.value.length} 项信息尚未确认`
    : '今天还没有记录',
)

/** 顶栏副标题：当前病程标题 + 第几周 + 上次记录 */
const headerSubtitle = computed(() => {
  if (!episode.value) return '还没有病程记录'
  const parts: string[] = [episode.value.title]
  const onset = episode.value.onset_date
  if (onset) {
    const weeks = weeksSince(onset)
    parts.push(Number.isNaN(weeks) ? '起病时间尚未确认' : `第 ${weeks} 周`)
  } else {
    parts.push('起病时间尚未确认')
  }
  const latest = events.value[0]
  parts.push(latest ? `上次记录：${relativeDayLabel(beijingDate(latest.occurred_at))}` : '上次记录：尚无')
  return parts.join(' · ')
})

/** 最新一页分析摘要：由该病程的事件组合（server 暂无「取最新分析」接口） */
const analysisRows = computed(() => {
  const list = events.value
  const latestReport = list.find((e) => e.event_type === '报告')
  const latestAdvice = list.find((e) => e.event_type === '医嘱')
  const unconfirmed = unconfirmedEvents.value

  const known = latestReport
    ? `${excerpt(latestReport.raw_text, 42)}（${latestReport.source_type}）`
    : '报告尚未录入，可在「录入报告」中粘贴原文'

  const unknown =
    unconfirmed.length > 0
      ? unconfirmed
          .slice(0, 2)
          .map((e) => `${excerpt(e.raw_text, 24)}（${e.source_type}）`)
          .join('；')
      : '暂无尚未确认项'

  const next = latestAdvice
    ? `${excerpt(latestAdvice.raw_text, 30)}（${latestAdvice.source_type}）`
    : '复诊问题可在问与解释中加入'

  return [
    { key: 'known', label: '已知', text: known },
    { key: 'unknown', label: '未知', text: unknown },
    { key: 'next', label: '下一步', text: next },
  ]
})

const analysisNote = computed(() => {
  const count = events.value.length
  const latest = events.value[0]
  const when = latest ? relativeDayLabel(beijingDate(latest.occurred_at)) : '尚无'
  return `由你的病程记录整理（${count} 条，最近记录：${when}）；一页分析含完整五段结构与来源。`
})

/** 快捷入口（复诊摘要的说明来自最近一份摘要的问题数） */
const quickEntries = computed<QuickEntry[]>(() => {
  const questionCount = followupQuestions.value
  return [
    {
      key: 'today',
      title: '记录今天',
      desc: '约 1 分钟',
      icon: 'edit',
      onClick: goTimeline,
    },
    { key: 'report', title: '录入报告', desc: '粘贴文字', icon: 'upload', onClick: goTimeline },
    { key: 'qa', title: '问与解释', desc: '基于当前上下文', icon: 'chat', onClick: goQa },
    {
      key: 'followup',
      title: '复诊摘要',
      desc: questionCount === null ? '固定六段，可导出' : `${questionCount} 个问题待确认`,
      icon: 'clipboard',
      onClick: goFollowup,
    },
  ]
})

/** 复诊倒计时：解析医嘱里的复查间隔，标注来源与核实状态 */
const revisit = computed(() => {
  const advice = events.value.find((e) => e.event_type === '医嘱' && e.raw_text)
  const rawText = advice?.raw_text ?? ''
  const unverified = (text: string) => `来源：你录入的医嘱「${excerpt(text, 18)}」 · 未经核实`
  if (!rawText) {
    return {
      title: '复查提醒：尚未确认',
      source: '来源：病程中暂无带复查时间的医嘱记录',
      days: Number.NaN,
    }
  }
  const matched = REVISIT_RE.exec(rawText)
  const occurred = advice ? beijingDate(advice.occurred_at) : ''
  if (!matched || !occurred) {
    return { title: '复查提醒：尚未确认', source: unverified(rawText), days: Number.NaN }
  }
  const amount = parseCountToken(matched[1])
  const unit = matched[2] === '周' ? '周' : matched[2] === '个月' || matched[2] === '月' ? '个月' : '天'
  const date = addToDate(occurred, amount, unit)
  const diff = daysFromToday(date)
  const suffix = Number.isNaN(diff)
    ? ''
    : diff > 0
      ? `（约 ${diff} 天后）`
      : diff === 0
        ? '（就是今天）'
        : `（已过去 ${-diff} 天，尚未确认新时间）`
  return { title: `计划复诊：${date}${suffix}`, source: unverified(rawText), days: diff }
})

/** 为你推荐：取服务端返回的第一条已发布内容（含推荐理由） */
const recommend = computed<ContentListItem | null>(() => recommends.value[0] ?? null)

/* ---------- 交互 ---------- */

/** 内联确认单条尚未确认的事件 */
async function onConfirmItem(item: PendingItem) {
  if (item.kind !== 'event' || !item.eventId || !episode.value) return
  confirmingId.value = item.eventId
  try {
    await confirmEvent(episode.value.id, item.eventId)
    toast('已确认这一项')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '确认失败，请稍后重试')
  } finally {
    confirmingId.value = ''
  }
}

/** 现在确认：对当前列出的尚未确认事件逐条内联确认（用户本人操作） */
async function onConfirmAll() {
  if (!episode.value || confirmingId.value) return
  const ids = unconfirmedEvents.value.map((e) => e.id)
  if (ids.length === 0) {
    goTimeline()
    return
  }
  confirmingId.value = 'all'
  try {
    for (const id of ids) {
      await confirmEvent(episode.value.id, id)
    }
    toast(`已确认 ${ids.length} 项信息`)
    pendingDismissed.value = false
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '确认失败，请稍后重试')
  } finally {
    confirmingId.value = ''
  }
}

/** 生成一页分析（POST /analyses；命中红旗时服务端返回就医提示） */
async function onGenerateAnalysis() {
  if (!episode.value || generating.value) return
  generating.value = true
  try {
    const res = await createAnalysis({ episode_id: episode.value.id })
    if (res.status === 'queued') {
      toast('一页分析任务已提交，完成后在问与解释中查看')
    } else {
      toast('个性化分析暂不可用，已改为可用的回退内容')
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '提交分析失败，请稍后重试')
  } finally {
    generating.value = false
  }
}

/** 空状态：引导创建病程 */
async function onCreateEpisode() {
  if (creating.value) return
  creating.value = true
  try {
    await createEpisode({ title: '我的腰痛病程' })
    toast('病程已创建，可开始记录今天')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '创建病程失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

function goTimeline() {
  uni.reLaunch({ url: '/pages/timeline/index' })
}

function goQa() {
  uni.reLaunch({ url: '/pages/qa/index' })
}

function goFollowup() {
  uni.reLaunch({ url: '/pages/followup/index' })
}

function goMine() {
  uni.reLaunch({ url: '/pages/mine/index' })
}

/** 未登录时去登录页（A01） */
function goLogin() {
  uni.reLaunch({ url: '/pages/login/login' })
}

function onBell() {
  toast('消息通知在后续任务实现')
}

/** 事件文字：原文优先；无原文时用症状记录字段兜底（不写「无」） */
function eventText(event: CareEventView): string {
  const raw = excerpt(event.raw_text, 30)
  if (raw) return raw
  const log = event.symptom_log
  if (log) return `记录显示：能坐 ${log.sit_minutes_display}，${log.leg_change}`
  return `${event.event_type}记录（无原文）`
}
</script>

<template>
  <view class="home-page">
    <!-- 自定义顶栏：标题 + 病程摘要 + 通知 / 头像 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__titles">
          <text class="nav__title">当前情况</text>
          <text class="nav__subtitle">{{ headerSubtitle }}</text>
        </view>
        <view class="nav__actions">
          <view class="nav__icon" hover-class="nav__icon--hover" :hover-stay-time="80" @click="onBell">
            <AppIcon name="bell" :size="22" />
          </view>
          <view class="nav__avatar" hover-class="nav__icon--hover" :hover-stay-time="80" @click="goMine">
            <text class="nav__avatar-text">U</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 未登录 -->
    <AppCard v-if="!auth.isLoggedIn" title="需要登录后查看当前情况" subtitle="登录只需手机号与验证码">
      <text class="body-text">登录后可查看病程、待确认项与一页分析摘要；就医提示无需登录即可查看。</text>
      <view class="gap-md" />
      <AppButton type="primary" block @click="goLogin">去登录 / 注册</AppButton>
    </AppCard>

    <!-- 加载中 -->
    <view v-else-if="loading" class="aux-text home-loading">加载中…</view>

    <template v-else>
      <!-- 接口异常提示（不阻断页面其他内容） -->
      <AppNotice v-if="errorText" type="warn" title="数据加载出现问题">
        {{ errorText }}
        <view class="gap-sm" />
        <AppButton type="soft" @click="load">重试</AppButton>
      </AppNotice>

      <!-- 空状态：引导创建病程 -->
      <AppCard v-if="!episode" title="还没有病程记录" subtitle="创建后即可记录今天的变化与报告">
        <text class="body-text">
          创建一病程后，可以记录今天的状态、录入检查报告，并整理成一页分析带去复诊。
        </text>
        <view class="gap-md" />
        <AppButton type="primary" block :loading="creating" @click="onCreateEpisode">创建病程</AppButton>
      </AppCard>

      <template v-else>
        <!-- 待确认项优先 -->
        <view v-if="showPending" class="pending-card">
          <view class="pending-card__head">
            <AppIcon class="pending-card__icon" name="alert" :size="18" />
            <text class="pending-card__title">{{ pendingTitle }}</text>
          </view>
          <view v-for="item in pendingItems" :key="item.key" class="pending-item">
            <text class="pending-item__dot">·</text>
            <text class="pending-item__text">{{ item.text }}</text>
            <text
              v-if="item.kind === 'event'"
              class="pending-item__action"
              :class="{ 'pending-item__action--busy': confirmingId === item.eventId }"
              @click="onConfirmItem(item)"
            >
              {{ confirmingId === item.eventId ? '确认中' : '确认' }}
            </text>
            <text v-else class="pending-item__action" @click="goTimeline">记录今天</text>
          </view>
          <view class="pending-card__actions">
            <AppButton
              type="primary"
              :loading="confirmingId === 'all'"
              :disabled="confirmingId !== '' && confirmingId !== 'all'"
              @click="onConfirmAll"
            >
              现在确认（约 30 秒）
            </AppButton>
            <AppButton type="secondary" @click="pendingDismissed = true">稍后</AppButton>
          </view>
        </view>

        <!-- 最新一页分析 -->
        <AppCard title="最新一页分析">
          <template #extra>
            <StatusTag status="generated" text="系统生成" />
          </template>
          <view v-for="row in analysisRows" :key="row.key" class="analysis-row">
            <text class="analysis-row__label" :class="`analysis-row__label--${row.key}`">{{ row.label }}</text>
            <text class="analysis-row__text">{{ row.text }}</text>
          </view>
          <view class="gap-sm" />
          <text class="aux-text">{{ analysisNote }}</text>
          <view class="gap-md" />
          <AppButton type="soft" block :loading="generating" @click="onGenerateAnalysis">生成一页分析</AppButton>
        </AppCard>

        <!-- 快捷入口 -->
        <view class="quick-grid">
          <view
            v-for="entry in quickEntries"
            :key="entry.key"
            class="quick-card"
            hover-class="quick-card--hover"
            :hover-stay-time="80"
            @click="entry.onClick"
          >
            <AppIcon class="quick-card__icon" :name="entry.icon" :size="24" />
            <text class="quick-card__title">{{ entry.title }}</text>
            <text class="quick-card__desc">{{ entry.desc }}</text>
          </view>
        </view>

        <!-- 复诊倒计时 -->
        <AppCard>
          <view class="revisit">
            <AppIcon class="revisit__icon" name="calendar" :size="22" />
            <view class="revisit__body">
              <text class="revisit__title">{{ revisit.title }}</text>
              <text class="revisit__source">{{ revisit.source }}</text>
            </view>
            <AppIcon class="revisit__arrow" name="arrow-right" :size="16" />
          </view>
        </AppCard>

        <!-- 为你推荐 -->
        <AppCard v-if="recommend" title="为你推荐" :subtitle="`原因：${recommend.recommend_reason}`">
          <view class="recommend">
            <view class="recommend__thumb">
              <AppIcon class="recommend__play" name="play" :size="22" />
            </view>
            <view class="recommend__body">
              <text class="recommend__title">{{ recommend.title }}</text>
              <view class="recommend__meta">
                <StatusTag
                  status="reviewed"
                  :text="recommend.version ? `已审核 v${recommend.version}` : '已审核'"
                />
                <text class="aux-text">{{ recommend.type }}</text>
              </view>
            </view>
          </view>
        </AppCard>
      </template>

      <!-- 就医提示（页面内可达） -->
      <view class="gap-lg" />
      <EmergencyEntry text="症状突然变化或出现严重信号？查看就医提示" />
    </template>

    <!-- 底部导航占位 -->
    <view class="tabbar-placeholder" />
  </view>

  <TabBar current="index" />
</template>

<style lang="scss">
.home-page {
  min-height: 100vh;
  padding: 0 $spacing-page $spacing-lg;
  background-color: $color-bg;
}

.home-loading {
  padding: $spacing-xl 0;
}

/* 卡片正文（14px Regular，行高 1.5） */
.body-text {
  display: block;
  font-size: 26rpx;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 自定义顶栏 ---------- */
.nav {
  background-color: $color-bg;
  padding-bottom: $spacing-md;
}

.nav__bar {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-md;
}

.nav__titles {
  flex: 1;
  min-width: 0;
}

.nav__title {
  display: block;
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.4;
}

.nav__subtitle {
  display: block;
  margin-top: 2rpx;
  font-size: 24rpx;
  color: $color-text-3;
  line-height: 1.4;
}

.nav__actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.nav__icon {
  width: 88rpx;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-text-2;
}

.nav__icon--hover {
  opacity: 0.7;
}

.nav__avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background-color: $color-primary-light;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav__avatar-text {
  font-size: 26rpx;
  font-weight: $font-weight-medium;
  color: $color-primary;
  line-height: 1.2;
}

/* ---------- 待确认项卡片 ---------- */
.pending-card {
  margin-bottom: $spacing-md;
  padding: $spacing-md;
  border-radius: $radius-card;
  background-color: $color-warn-light;
}

.pending-card__head {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.pending-card__icon {
  color: $color-warn;
  flex: none;
}

.pending-card__title {
  font-size: 30rpx;
  font-weight: $font-weight-medium;
  color: $color-warn;
  line-height: 1.4;
}

.pending-item {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  margin-top: $spacing-sm;
}

.pending-item__dot {
  color: $color-warn;
  font-size: 26rpx;
  line-height: 1.5;
}

.pending-item__text {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  color: $color-text-1;
  line-height: 1.5;
}

.pending-item__action {
  flex: none;
  min-width: 88rpx;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 $spacing-sm;
  font-size: 26rpx;
  font-weight: $font-weight-medium;
  color: $color-primary;
  line-height: 1.4;
  text-align: center;
}

.pending-item__action--busy {
  color: $color-text-3;
}

.pending-card__actions {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

/* ---------- 最新一页分析 ---------- */
.analysis-row {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  margin-top: $spacing-sm;
}

.analysis-row__label {
  flex: none;
  min-width: 88rpx;
  padding: 2rpx 0;
  border-radius: $radius-tag;
  font-size: 22rpx;
  font-weight: $font-weight-medium;
  color: $color-surface;
  text-align: center;
  line-height: 1.6;
}

.analysis-row__label--known {
  background-color: $color-primary;
}

.analysis-row__label--unknown {
  background-color: $color-warn;
}

.analysis-row__label--next {
  background-color: $color-ok;
}

.analysis-row__text {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  color: $color-text-2;
  line-height: 1.5;
}

/* ---------- 快捷入口 ---------- */
.quick-grid {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-md;
  margin: $spacing-md 0;
}

.quick-card {
  width: calc(50% - 12rpx);
  padding: $spacing-md;
  border-radius: $radius-card;
  background-color: $color-surface;
  border: 1rpx solid $color-border;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: $spacing-xs;
}

.quick-card--hover {
  opacity: 0.85;
}

.quick-card__icon {
  color: $color-primary;
}

.quick-card__title {
  font-size: 30rpx;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.4;
}

.quick-card__desc {
  font-size: 22rpx;
  color: $color-text-3;
  line-height: 1.4;
}

/* ---------- 复诊倒计时 ---------- */
.revisit {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding-top: $spacing-md;
}

.revisit__icon {
  flex: none;
  color: $color-primary;
}

.revisit__body {
  flex: 1;
  min-width: 0;
}

.revisit__title {
  display: block;
  font-size: 28rpx;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.4;
}

.revisit__source {
  display: block;
  margin-top: 2rpx;
  font-size: 22rpx;
  color: $color-text-3;
  line-height: 1.4;
}

.revisit__arrow {
  flex: none;
  color: $color-text-3;
}

/* ---------- 为你推荐 ---------- */
.recommend {
  display: flex;
  align-items: center;
  gap: $spacing-md;
}

.recommend__thumb {
  flex: none;
  width: 128rpx;
  height: 88rpx;
  border-radius: 16rpx;
  background-color: $color-neutral-light;
  display: flex;
  align-items: center;
  justify-content: center;
}

.recommend__play {
  color: $color-primary;
}

.recommend__body {
  flex: 1;
  min-width: 0;
}

.recommend__title {
  display: block;
  font-size: 28rpx;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.4;
}

.recommend__meta {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-top: $spacing-xs;
}
</style>
