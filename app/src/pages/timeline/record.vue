<script setup lang="ts">
/**
 * A11 记录今天（设计稿 docs/design/app/A11.png，设计宽度 375）
 *
 * 以生活任务组织记录；允许跳过；缺失不默认阴性；不复用昨日答案。
 *
 * 数据全部来自 server 接口：
 * - GET  /episodes/{id}/today       今天是否已记录（没有则空表单，不预填昨日答案）
 * - POST /episodes/{id}/today-logs  结构化记录（能坐多久 / 计划活动 / 睡眠 / 腿部变化 / 最担心）
 * - POST /episodes/{id}/events      「与昨天相比」与「今天做了什么」作为自述事件保存
 */
import { computed, onMounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import { useAuthStore } from '../../stores/auth'
import {
  addCareEvent,
  getTodayStatus,
  listEpisodes,
  logToday,
  type TodayStatus,
} from '../../api/episodes'
import { beijingToday, getStatusBarHeight } from '../../utils/system'

/** 能坐多久（设计稿选项 → 分钟中值，用于趋势图） */
const SIT_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: '<15分钟', minutes: 10 },
  { label: '15-30', minutes: 22 },
  { label: '30-60', minutes: 45 },
  { label: '>60分钟', minutes: 75 },
  { label: '跳过', minutes: null },
]

/** 计划活动完成情况（服务端枚举） */
const ACTIVITY_OPTIONS: { label: string; value: string | null }[] = [
  { label: '能', value: '完成' },
  { label: '部分', value: '部分完成' },
  { label: '不能', value: '未完成' },
  { label: '跳过', value: null },
]

/** 睡眠受影响程度（0-3） */
const SLEEP_OPTIONS: { label: string; value: number | null }[] = [
  { label: '0 没影响', value: 0 },
  { label: '1 偶尔醒', value: 1 },
  { label: '2 常醒', value: 2 },
  { label: '3 几乎没睡', value: 3 },
]

/** 与昨天相比（自述事件保存） */
const CHANGE_OPTIONS = ['加重', '差不多', '减轻', '跳过']

/** 腿部麻木或无力（不沿用昨天答案） */
const LEG_OPTIONS = ['有', '没有', '尚未确认']

/** 今天做了什么（可多选；作为行动事件保存） */
const ACTIVITY_LOG_OPTIONS = ['步行', '热敷', '按医嘱用药', '休息', '康复练习', '工作/久坐', '其他']

const auth = useAuthStore()
const statusBarHeight = ref(0)

const episodeId = ref('')
const today = ref<TodayStatus | null>(null)
const todayDate = ref(beijingToday())
const sitIndex = ref(-1)
const activityIndex = ref(-1)
const sleepIndex = ref(-1)
const changeIndex = ref(-1)
const legIndex = ref(-1)
const activities = ref<string[]>([])
const worry = ref('')
const saving = ref(false)

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  if (!auth.isLoggedIn) return
  try {
    const list = await listEpisodes()
    const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
    if (!active) return
    episodeId.value = active.id
    today.value = await getTodayStatus(active.id)
    if (today.value.logged) {
      uni.showToast({ title: '今天已记录，可继续补充', icon: 'none' })
    }
  } catch {
    // 取不到今天状态时不阻断录入
  }
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/** 选中态判断（索引 -1 = 未回答，不默认阴性） */
const isSitSelected = (i: number) => sitIndex.value === i
const isActivitySelected = (i: number) => activityIndex.value === i
const isSleepSelected = (i: number) => sleepIndex.value === i
const isChangeSelected = (i: number) => changeIndex.value === i
const isLegSelected = (i: number) => legIndex.value === i
const isActivityLogSelected = (label: string) => activities.value.includes(label)

function onPickSit(i: number) {
  sitIndex.value = sitIndex.value === i ? -1 : i
}
function onPickActivity(i: number) {
  activityIndex.value = activityIndex.value === i ? -1 : i
}
function onPickSleep(i: number) {
  sleepIndex.value = sleepIndex.value === i ? -1 : i
}
function onPickChange(i: number) {
  changeIndex.value = changeIndex.value === i ? -1 : i
}
function onPickLeg(i: number) {
  legIndex.value = legIndex.value === i ? -1 : i
}
function onToggleActivityLog(label: string) {
  activities.value = activities.value.includes(label)
    ? activities.value.filter((a) => a !== label)
    : [...activities.value, label]
}

/** 未回答项数量（提示用，不阻断保存） */
const unanswered = computed<number>(() => {
  let n = 0
  if (sitIndex.value < 0) n += 1
  if (activityIndex.value < 0) n += 1
  if (sleepIndex.value < 0) n += 1
  if (changeIndex.value < 0) n += 1
  if (legIndex.value < 0) n += 1
  return n
})

/** 保存记录：结构化字段走 today-logs；「与昨天相比 / 今天做了什么」作为自述事件 */
async function onSave(updateCurrent = false) {
  if (saving.value) return
  if (!auth.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  if (!episodeId.value) {
    toast('还没有病程，请先做关键变化确认')
    return
  }
  saving.value = true
  try {
    const sit = sitIndex.value >= 0 ? SIT_OPTIONS[sitIndex.value].minutes : null
    const activity = activityIndex.value >= 0 ? ACTIVITY_OPTIONS[activityIndex.value].value : null
    const sleep = sleepIndex.value >= 0 ? SLEEP_OPTIONS[sleepIndex.value].value : null
    const leg = legIndex.value >= 0 ? LEG_OPTIONS[legIndex.value] : null
    const worryText = worry.value.trim()

    // 1) 结构化记录（缺失字段服务端记为「尚未确认」）
    await logToday(episodeId.value, {
      sit_minutes: sit,
      planned_activity_done: activity,
      sleep_impact: sleep,
      top_worry: worryText || null,
      leg_change: leg,
    })

    // 2) 「与昨天相比」与「今天做了什么」：自述事件，保留来源
    const extra: string[] = []
    if (changeIndex.value >= 0) extra.push(`与昨天相比：${CHANGE_OPTIONS[changeIndex.value]}`)
    if (activities.value.length > 0) extra.push(`今天做了：${activities.value.join('、')}`)
    if (extra.length > 0) {
      await addCareEvent(episodeId.value, {
        event_type: '行动',
        source_type: '自述',
        raw_text: `记录今天（${todayDate.value}）：${extra.join('；')}（自述，尚未确认）`,
        verify_status: '尚未确认',
        occurred_at: new Date().toISOString(),
      })
    }

    toast(unanswered.value > 0 ? `已保存（${unanswered.value} 项未回答，记为尚未确认）` : '已保存今天的记录')
    if (updateCurrent) {
      // 症状有新变化时更新「当前情况」
      uni.reLaunch({ url: '/pages/change/confirm' })
    } else {
      uni.navigateBack({
        fail: () => uni.reLaunch({ url: '/pages/timeline/index' }),
      })
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

function onBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/timeline/index' }),
  })
}
</script>

<template>
  <view class="page record-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">记录今天</text>
        <view class="nav__duration">
          <text class="nav__duration-text">约 1 分钟</text>
        </view>
      </view>
    </view>

    <view class="record-body">
      <!-- 引导：每个问题都可以跳过 -->
      <view class="record-intro">
        <AppIcon name="timeline" :size="18" />
        <text class="record-intro__text">
          {{ todayDate }} · 每个问题都可以跳过，跳过会记为“尚未确认”
        </text>
      </view>

      <!-- Q1 今天能坐多久 -->
      <view class="q-card">
        <text class="q-card__title">今天能坐多久？</text>
        <view class="q-card__chips">
          <view
            v-for="(opt, i) in SIT_OPTIONS"
            :key="opt.label"
            class="q-chip"
            :class="{ 'q-chip--selected': isSitSelected(i) }"
            hover-class="q-chip--hover"
            :hover-stay-time="80"
            @click="onPickSit(i)"
          >
            <text class="q-chip__text">{{ opt.label }}</text>
          </view>
        </view>
      </view>

      <!-- Q2 能否完成原本计划的活动 -->
      <view class="q-card">
        <text class="q-card__title">能否完成原本计划的活动？</text>
        <view class="q-card__chips">
          <view
            v-for="(opt, i) in ACTIVITY_OPTIONS"
            :key="opt.label"
            class="q-chip"
            :class="{ 'q-chip--selected': isActivitySelected(i) }"
            hover-class="q-chip--hover"
            :hover-stay-time="80"
            @click="onPickActivity(i)"
          >
            <text class="q-chip__text">{{ opt.label }}</text>
          </view>
        </view>
      </view>

      <!-- Q3 睡眠受影响程度 -->
      <view class="q-card">
        <text class="q-card__title">睡眠受影响程度</text>
        <view class="q-card__chips">
          <view
            v-for="(opt, i) in SLEEP_OPTIONS"
            :key="opt.label"
            class="q-chip"
            :class="{ 'q-chip--selected': isSleepSelected(i) }"
            hover-class="q-chip--hover"
            :hover-stay-time="80"
            @click="onPickSleep(i)"
          >
            <text class="q-chip__text">{{ opt.label }}</text>
          </view>
        </view>
      </view>

      <!-- Q4 与昨天相比 -->
      <view class="q-card">
        <text class="q-card__title">与昨天相比</text>
        <view class="q-card__chips">
          <view
            v-for="(opt, i) in CHANGE_OPTIONS"
            :key="opt"
            class="q-chip"
            :class="{ 'q-chip--selected': isChangeSelected(i) }"
            hover-class="q-chip--hover"
            :hover-stay-time="80"
            @click="onPickChange(i)"
          >
            <text class="q-chip__text">{{ opt }}</text>
          </view>
        </view>
      </view>

      <!-- Q5 今天有腿部麻木或无力吗 -->
      <view class="q-card">
        <text class="q-card__title">今天有腿部麻木或无力吗？</text>
        <text class="q-card__note">不会沿用昨天的答案——如果你今天不确定，请选“尚未确认”。</text>
        <view class="q-card__chips">
          <view
            v-for="(opt, i) in LEG_OPTIONS"
            :key="opt"
            class="q-chip"
            :class="{ 'q-chip--selected': isLegSelected(i) }"
            hover-class="q-chip--hover"
            :hover-stay-time="80"
            @click="onPickLeg(i)"
          >
            <text class="q-chip__text">{{ opt }}</text>
          </view>
        </view>
      </view>

      <!-- Q6 今天做了什么（可多选） -->
      <view class="q-card">
        <text class="q-card__title">今天做了什么？（可多选）</text>
        <view class="q-card__chips">
          <view
            v-for="opt in ACTIVITY_LOG_OPTIONS"
            :key="opt"
            class="q-chip"
            :class="{ 'q-chip--selected': isActivityLogSelected(opt) }"
            hover-class="q-chip--hover"
            :hover-stay-time="80"
            @click="onToggleActivityLog(opt)"
          >
            <text class="q-chip__text">{{ opt }}</text>
          </view>
        </view>
      </view>

      <!-- Q7 今天最担心什么 -->
      <view class="q-card">
        <text class="q-card__title">今天最担心什么？</text>
        <view class="q-card__textarea-box">
          <textarea
            v-model="worry"
            class="q-card__textarea"
            placeholder="例如：会不会越来越严重 / 要不要换医院…"
            placeholder-class="q-card__textarea-placeholder"
            :maxlength="200"
            :adjust-position="false"
          />
        </view>
      </view>

      <!-- 说明 -->
      <AppNotice type="info">
        记录只用于整理你的病程和复诊摘要；变化图不会把某一次疼痛上升解读为影像恶化。
      </AppNotice>
    </view>

    <!-- 底部操作 -->
    <view class="record-footer">
      <AppButton type="primary" block :loading="saving" @click="onSave(false)">保存记录</AppButton>
      <view class="record-footer__update" hover-class="record-footer__update--hover" :hover-stay-time="80" @click="onSave(true)">
        <text class="record-footer__update-text">保存并更新“当前情况”（症状有新变化时）</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.record-page {
  min-height: 100vh;
  background-color: $color-bg;
  display: flex;
  flex-direction: column;
}

.record-body {
  flex: 1;
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 引导 ---------- */
.record-intro {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  color: $color-text-2;
}

.record-intro__text {
  font-size: $font-size-aux;
  color: $color-text-2;
}

/* ---------- 问题卡片 ---------- */
.q-card {
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
}

.q-card__title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.q-card__note {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

.q-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

.q-chip {
  min-height: 64rpx;
  padding: $spacing-xs $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-pill;
  display: flex;
  align-items: center;
  justify-content: center;

  &--selected {
    background-color: $color-primary;
    border-color: $color-primary;
  }

  &--hover {
    opacity: 0.85;
  }
}

.q-chip__text {
  font-size: $font-size-body;
  color: $color-text-1;

  .q-chip--selected & {
    color: $color-surface;
    font-weight: $font-weight-medium;
  }
}

.q-card__textarea-box {
  margin-top: $spacing-md;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
}

.q-card__textarea {
  width: 100%;
  min-height: 140rpx;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;

  &-placeholder {
    color: $color-text-3;
  }
}

/* ---------- 底部 ---------- */
.record-footer {
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  background-color: $color-surface;
  border-top: 2rpx solid $color-border;
}

.record-footer__update {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &--hover {
    opacity: 0.7;
  }
}

.record-footer__update-text {
  font-size: $font-size-body;
  color: $color-primary;
}
</style>
