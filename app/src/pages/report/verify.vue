<script setup lang="ts">
/**
 * A06 核对结构化信息（设计稿 docs/design/app/A06.png，设计宽度 375，第 4/4 步）
 *
 * 来源、时间、核实状态可见；冲突项必须由用户确认；缺失不默认阴性。
 *
 * 数据全部来自 server 接口：
 * - GET  /episodes/{id}/structured  整理后的结构化信息（来源 / 时间 / 核实状态 / 术语）
 * - PATCH /episodes/{id}/events/{id} 冲突项确认（verify_status = 已确认）
 * - POST /analyses                  确认无误后生成一页分析（命中红旗走就医提示分支）
 */
import { computed, onMounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import { useAuthStore } from '../../stores/auth'
import { confirmEvent, getEpisode, listEpisodes, type EpisodeDetail } from '../../api/episodes'
import { getStructured, type ExtractedTerm, type StructuredItem } from '../../api/reports'
import { createAnalysis, safetyNoticeFromError } from '../../api/analyses'
import { getStatusBarHeight } from '../../utils/system'

/** 本地存储键：A04 选择的主要困惑 */
const CONFUSION_STORAGE_KEY = 'yyj_confusion'

/** 主要困惑键 → 展示文案 */
const CONFUSION_LABELS: Record<string, string> = {
  report: '报告术语',
  course: '病程变化',
  followup: '复诊准备',
  life: '生活影响',
}

/** 症状摘要（A02 写入，格式固定）的题号 → 行标签 */
const SUMMARY_QUESTIONS: { prefix: string; label: string }[] = [
  { prefix: '1.', label: '最近变化' },
  { prefix: '2.', label: '需要医生及时评估的情况' },
  { prefix: '3.', label: '主要涉及侧别' },
  { prefix: '4.', label: '症状开始' },
]

const UNCONFIRMED = '尚未确认'

const auth = useAuthStore()
const statusBarHeight = ref(0)

const loading = ref(true)
const submitting = ref(false)
const episodeId = ref('')
const episode = ref<EpisodeDetail | null>(null)
const items = ref<StructuredItem[]>([])
const /** 侧别冲突的两种解决方式 */ sideChoice = ref('')
const confusionLabel = ref('')

/** 最新一条报告（结构化信息） */
const reportItem = computed<StructuredItem | undefined>(() => items.value.find((i) => i.report))
/** 最新一条症状事件（A02 的结构化摘要） */
const symptomItem = computed<StructuredItem | undefined>(
  () => items.value.find((i) => i.event_type === '症状') ?? undefined,
)
/** 既有医嘱（自述转述） */
const adviceItems = computed<StructuredItem[]>(() => items.value.filter((i) => i.event_type === '医嘱'))

/** 报告中的侧别（右侧神经根受压 → 右侧） */
const reportSide = computed<string>(() => {
  const text = reportItem.value?.report ? reportTextOf(reportItem.value) : ''
  const m = /(左|右)侧/.exec(text)
  return m ? `${m[1]}侧` : ''
})

/** 症状摘要中用户描述的侧别 */
const selfSide = computed<string>(() => {
  const answer = answerOf(symptomItem.value, '3.')
  if (answer === UNCONFIRMED) return ''
  const m = /(左|右)侧/.exec(answer)
  return m ? `${m[1]}侧` : ''
})

/** 侧别冲突：报告与自述都提到了侧别且不一致 */
const sideConflict = computed<boolean>(
  () => Boolean(reportSide.value) && Boolean(selfSide.value) && reportSide.value !== selfSide.value,
)

onMounted(() => {
  statusBarHeight.value = getStatusBarHeight()
  load()
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

async function load() {
  loading.value = true
  try {
    const pref = uni.getStorageSync(CONFUSION_STORAGE_KEY) as { confusion?: string } | undefined
    confusionLabel.value = pref?.confusion ? CONFUSION_LABELS[pref.confusion] ?? pref.confusion : ''

    const list = await listEpisodes()
    const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
    if (!active) {
      items.value = []
      return
    }
    episodeId.value = active.id
    episode.value = await getEpisode(active.id)
    const structured = await getStructured(active.id)
    items.value = structured.items
  } catch (e) {
    toast(e instanceof Error ? e.message : '数据加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

/* ---------- 解析症状摘要（A02 写入的固定格式） ---------- */

function answerOf(item: StructuredItem | undefined, prefix: string): string {
  if (!item?.raw_text) return UNCONFIRMED
  const line = item.raw_text
    .split('\n')
    .find((l) => l.trim().startsWith(prefix))
  if (!line) return UNCONFIRMED
  const idx = line.indexOf('？')
  const answer = idx >= 0 ? line.slice(idx + 1).trim() : ''
  return answer || UNCONFIRMED
}

function reportTextOf(item: StructuredItem): string {
  return item.raw_text ?? ''
}

/** 术语在原文中的行号（回看原文定位） */
function termLine(term: ExtractedTerm, rawText: string): number {
  const before = rawText.slice(0, term.start)
  return before.split('\n').length
}

/* ---------- 侧别冲突确认 ---------- */

async function onSideChoice(choice: string) {
  sideChoice.value = choice
  const item = symptomItem.value
  if (!item) return
  try {
    await confirmEvent(episodeId.value, item.care_event_id)
    toast('已记录你的确认')
  } catch (e) {
    toast(e instanceof Error ? e.message : '确认失败，请稍后重试')
  }
}

/* ---------- 生成一页分析 ---------- */

async function onGenerate() {
  if (submitting.value) return
  if (!auth.isLoggedIn) {
    toast('登录后才能生成一页分析')
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  if (!episodeId.value) {
    toast('还没有可分析的病程记录')
    return
  }
  submitting.value = true
  try {
    const result = await createAnalysis({ episode_id: episodeId.value })
    if (result.status !== 'queued') {
      // 个性化分析开关关闭：服务端返回回退内容（详见 T20 的回退界面）
      toast('个性化分析暂不可用，已返回可用的回退内容')
      return
    }
    uni.navigateTo({ url: `/pages/analysis/index?task_id=${encodeURIComponent(result.task_id)}` })
  } catch (e) {
    // 命中红旗（40910/40911）：响应 data 即就医提示内容，立即展示、不阻断
    const notice = safetyNoticeFromError(e)
    if (notice) {
      const query = [
        `signals=${encodeURIComponent(notice.matched.map((m) => m.label).join('、'))}`,
        `stop=${notice.matched.some((m) => m.severity === 'high') ? '1' : '0'}`,
        `rule=${encodeURIComponent(notice.rule_set_version ?? '')}`,
      ].join('&')
      uni.navigateTo({ url: `/pages/emergency/notice?${query}` })
    } else {
      toast(e instanceof Error ? e.message : '生成分析失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}

function onEditReport() {
  uni.navigateTo({ url: '/pages/report/input' })
}

function onEditSymptom() {
  uni.navigateTo({ url: '/pages/change/confirm' })
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
  <view class="page verify-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">核对整理后的信息</text>
        <view class="nav__step">
          <text class="nav__step-text">第 4/4 步</text>
        </view>
      </view>
    </view>

    <view class="verify-body">
      <!-- 引导提示 -->
      <AppNotice type="info">请核对系统整理的信息。缺失项显示为“尚未确认”，冲突项需要你确认后才会进入分析。</AppNotice>

      <!-- 报告信息 -->
      <AppCard>
        <view class="card-head">
          <view class="card-head__title-wrap">
            <text class="card-head__title">报告信息</text>
            <text v-if="reportItem?.report?.report_date" class="card-head__date">· {{ reportItem.report.report_date }}</text>
          </view>
          <view class="card-head__right">
            <StatusTag status="quote" text="来源：报告原文" />
            <view class="card-head__edit" hover-class="card-head__edit--hover" :hover-stay-time="80" @click="onEditReport">
              <AppIcon name="edit" :size="18" />
            </view>
          </view>
        </view>

        <view v-if="reportItem?.report" class="rows">
          <view
            v-for="term in reportItem.report.extracted_terms"
            :key="`${term.term}-${term.start}`"
            class="row"
          >
            <text class="row__label">{{ term.term }}</text>
            <text class="row__value">{{ term.meaning }}</text>
            <view class="row__pos">
              <text class="row__pos-text">原文第{{ termLine(term, reportItem.raw_text ?? '') }}行</text>
            </view>
          </view>
        </view>
        <view v-else class="empty">
          <text class="empty__text">还没有录入报告原文（{{ UNCONFIRMED }}）</text>
        </view>

        <!-- 侧别冲突：必须由用户确认 -->
        <view v-if="sideConflict" class="conflict">
          <view class="conflict__head">
            <AppIcon name="alert" :size="18" />
            <text class="conflict__title">
              侧别冲突：报告为“{{ reportSide }}”，你的描述为“{{ selfSide }}”
            </text>
          </view>
          <view class="conflict__actions">
            <view
              class="conflict__btn"
              :class="{ 'conflict__btn--selected': sideChoice === 'left' }"
              hover-class="conflict__btn--hover"
              :hover-stay-time="80"
              @click="onSideChoice('left')"
            >
              <text class="conflict__btn-text">我的症状在{{ selfSide }}</text>
            </view>
            <view
              class="conflict__btn"
              :class="{ 'conflict__btn--selected': sideChoice === 'both' }"
              hover-class="conflict__btn--hover"
              :hover-stay-time="80"
              @click="onSideChoice('both')"
            >
              <text class="conflict__btn-text">都有 / 不确定</text>
            </view>
          </view>
        </view>
      </AppCard>

      <!-- 症状与变化 -->
      <AppCard>
        <view class="card-head">
          <view class="card-head__title-wrap">
            <text class="card-head__title">症状与变化</text>
          </view>
          <view class="card-head__right">
            <StatusTag status="self" text="来源：自述" />
            <view class="card-head__edit" hover-class="card-head__edit--hover" :hover-stay-time="80" @click="onEditSymptom">
              <AppIcon name="edit" :size="18" />
            </view>
          </view>
        </view>

        <view class="rows">
          <view v-for="q in SUMMARY_QUESTIONS" :key="q.prefix" class="row">
            <text class="row__label">{{ q.label }}</text>
            <text class="row__value">{{ answerOf(symptomItem, q.prefix) }}</text>
            <StatusTag
              v-if="answerOf(symptomItem, q.prefix) === UNCONFIRMED"
              status="unconfirmed"
            />
            <StatusTag v-else status="confirmed" />
          </view>
          <view class="row">
            <text class="row__label">主要困惑</text>
            <text class="row__value">{{ confusionLabel || UNCONFIRMED }}</text>
            <StatusTag v-if="!confusionLabel" status="unconfirmed" />
            <StatusTag v-else status="confirmed" />
          </view>
        </view>
      </AppCard>

      <!-- 既有医嘱 -->
      <AppCard>
        <view class="card-head">
          <view class="card-head__title-wrap">
            <text class="card-head__title">既有医嘱</text>
          </view>
          <view class="card-head__right">
            <StatusTag status="self" text="来源：自述" />
          </view>
        </view>
        <view v-if="adviceItems.length > 0" class="rows">
          <view v-for="item in adviceItems" :key="item.care_event_id" class="row">
            <text class="row__label">医生建议</text>
            <text class="row__value">{{ item.raw_text }}</text>
            <StatusTag status="unverified" />
          </view>
        </view>
        <view v-else class="empty">
          <text class="empty__text">还没有录入医嘱（{{ UNCONFIRMED }}）</text>
        </view>
      </AppCard>

      <!-- 未确认语义提示 -->
      <AppNotice type="warn">
        “尚未确认”不会被当作“没有”；旧记录中的“当时没有”也不会被当作“现在没有”。
      </AppNotice>
    </view>

    <!-- 底部操作 -->
    <view class="verify-footer">
      <AppButton type="primary" block :loading="submitting" @click="onGenerate">确认无误，生成一页分析</AppButton>
      <view class="verify-footer__back" hover-class="verify-footer__back--hover" :hover-stay-time="80" @click="onEditReport">
        <text class="verify-footer__back-text">返回修改</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.verify-page {
  min-height: 100vh;
  background-color: $color-bg;
  display: flex;
  flex-direction: column;
}

.verify-body {
  flex: 1;
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 卡片头部 ---------- */
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $spacing-md;
}

.card-head__title-wrap {
  display: flex;
  align-items: baseline;
  min-width: 0;
}

.card-head__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.card-head__date {
  font-size: $font-size-aux;
  color: $color-text-2;
  margin-left: $spacing-xs;
}

.card-head__right {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  flex-shrink: 0;
}

.card-head__edit {
  width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-text-3;

  &--hover {
    opacity: 0.7;
  }
}

/* ---------- 信息行 ---------- */
.rows {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: flex-start;
  padding: $spacing-md 0;
  border-top: 2rpx solid $color-border;

  &:first-child {
    border-top: none;
    padding-top: 0;
  }
}

.row__label {
  width: 168rpx;
  flex-shrink: 0;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
}

.row__value {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
  min-width: 0;
}

.row__pos {
  margin-left: $spacing-sm;
  padding: 2rpx $spacing-xs;
  background-color: $color-info-light;
  border-radius: $radius-tag;
  flex-shrink: 0;

  &-text {
    font-size: $font-size-tag;
    color: $color-info;
  }
}

.row :deep(.status-tag) {
  margin-left: $spacing-sm;
  flex-shrink: 0;
}

/* ---------- 空状态 ---------- */
.empty {
  padding: $spacing-md 0;
}

.empty__text {
  font-size: $font-size-body;
  color: $color-text-3;
}

/* ---------- 侧别冲突 ---------- */
.conflict {
  margin-top: $spacing-md;
  padding: $spacing-md;
  background-color: $color-error-light;
  border-radius: $radius-button;
}

.conflict__head {
  display: flex;
  align-items: flex-start;
  gap: $spacing-xs;
  color: $color-error;
}

.conflict__title {
  font-size: $font-size-body;
  color: $color-error;
  line-height: $line-height-body;
  flex: 1;
}

.conflict__actions {
  display: flex;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

.conflict__btn {
  flex: 1;
  min-height: 72rpx;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  display: flex;
  align-items: center;
  justify-content: center;

  &--selected {
    border-color: $color-primary;
    background-color: $color-primary-light;
  }

  &--hover {
    opacity: 0.85;
  }
}

.conflict__btn-text {
  font-size: $font-size-body;
  color: $color-text-1;
}

/* ---------- 底部操作 ---------- */
.verify-footer {
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  background-color: $color-surface;
  border-top: 2rpx solid $color-border;
}

.verify-footer__back {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &--hover {
    opacity: 0.7;
  }
}

.verify-footer__back-text {
  font-size: $font-size-body;
  color: $color-primary;
}
</style>
