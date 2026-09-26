<script setup lang="ts">
/**
 * A15 视频详情（设计稿 docs/design/app/A15.png，设计宽度 375）
 *
 * 适用 / 不适用范围、审核版本与依据、字幕与文字替代、复述任务检验理解。
 * 示意图不是用户真实病变；内容有误可举报。
 *
 * 数据全部来自 server 接口：
 * - GET /contents/{id}  内容详情（版本链、审核记录、字幕与文字替代）
 * - POST /feedback/error-report  内容举报（自动附带内容版本）
 */
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue';
import { getContentDetail, type ContentDetail } from '../../api/contents'
import { submitErrorReport } from '../../api/feedback'
import { beijingDate, getStatusBarHeight } from '../../utils/system'

const statusBarHeight = ref(0)
const contentId = ref('')
const detail = ref<ContentDetail | null>(null)
const loading = ref(true)
const errorText = ref('')

/** 字幕开关（设计稿：CC 开） */
const subtitleOn = ref(true)
/** 文字替代全文展开 */
const subtitleExpanded = ref(false)
/** 复述输入 */
const retelling = ref('')
const retellDone = ref(false)
/** 内容反馈 */
const helpDone = ref('')

onLoad((options) => {
  const id = (options as { id?: string } | undefined)?.id
  contentId.value = typeof id === 'string' ? id : ''
})

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  if (!contentId.value) {
    errorText.value = '缺少内容信息'
    loading.value = false
    return
  }
  try {
    detail.value = await getContentDetail(contentId.value)
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '内容加载失败'
  } finally {
    loading.value = false
  }
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/* ---------- 派生数据 ---------- */

const current = computed(() => detail.value?.current_version ?? null)
const version = computed<number>(() => current.value?.version ?? 1)
/** 审核通过日期（取最近一条「通过」审核记录） */
const reviewedDate = computed<string>(() => {
  const records = detail.value?.review_records ?? []
  const passed = records.find((r) => r.decision === '通过' || r.decision === '提交审核')
  const at = passed?.reviewed_at ?? current.value?.published_at
  return at ? beijingDate(at) : ''
})
/** 依据（审核范围，如「医学准确性」） */
const reviewScope = computed<string>(() => {
  const records = detail.value?.review_records ?? []
  const passed = records.find((r) => r.decision === '通过')
  return passed?.review_scope ?? '临床审定'
})
/** 适用 / 不适用 */
const applicable = computed<string[]>(() =>
  (detail.value?.applicable_scope ?? '').split(/[；;，,]/).filter((s) => s.trim()),
)
const notApplicable = computed<string[]>(() =>
  (detail.value?.not_applicable ?? '').split(/[；;，,]/).filter((s) => s.trim() && s !== '—'),
)
/** 文字替代全文 */
const subtitleText = computed<string>(() => current.value?.subtitle_text ?? '')

/* ---------- 交互 ---------- */

function onToggleSubtitle() {
  subtitleOn.value = !subtitleOn.value
}

function onRetell() {
  if (!retelling.value.trim()) {
    toast('请用一句话说说你理解了什么（可跳过）')
    return
  }
  retellDone.value = true
  toast('已收到你的复述（不是考试，不影响分析结果）')
}

async function onHelp(value: string) {
  if (helpDone.value) return
  helpDone.value = value
  toast('已收到你的反馈')
}

async function onReportError() {
  if (!detail.value) return
  try {
    await submitErrorReport({
      content_item_id: detail.value.id,
      category: '内容出错',
      description: `内容举报：${detail.value.title}（版本 v${version.value}）`,
      severity: 'medium',
    })
    toast('已收到举报（会自动附带内容版本）')
  } catch (e) {
    toast(e instanceof Error ? e.message : '举报失败，请稍后重试')
  }
}

function onBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/index/index' }),
  })
}
</script>

<template>
  <view class="page detail-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">{{ detail?.type === '视频' ? '审核视频' : '审核图文' }}</text>
        <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="upload" :size="22" />
        </view>
      </view>
    </view>

    <view v-if="loading" class="detail-body">
      <AppNotice type="info">正在加载…</AppNotice>
    </view>

    <view v-else-if="errorText || !detail" class="detail-body">
      <AppNotice type="warn">{{ errorText || '内容不存在或已下线' }}</AppNotice>
    </view>

    <view v-else class="detail-body">
      <!-- 播放区（示意动画，非本人人像） -->
      <view class="player">
        <view class="player__stage">
          <view class="player__play">
            <AppIcon name="play" :size="30" />
          </view>
          <text class="player__caption">示意动画：{{ detail.title }}（非本人人像）</text>
        </view>
        <view class="player__bar">
          <view class="player__progress" />
          <text class="player__time">0:00</text>
          <view
            class="player__cc"
            :class="{ 'player__cc--on': subtitleOn }"
            hover-class="player__cc--hover"
            :hover-stay-time="80"
            @click="onToggleSubtitle"
          >
            <text class="player__cc-text">CC{{ subtitleOn ? '开' : '关' }}</text>
          </view>
        </view>
      </view>

      <!-- 标题与审核信息 -->
      <view class="detail-head">
        <text class="detail-head__title">{{ detail.title }}</text>
        <view class="detail-head__tags">
          <StatusTag status="reviewed" :text="`已审核 v${version}`" />
          <StatusTag status="self" :text="`${reviewScope} · ${reviewedDate}`" />
        </view>
        <view class="detail-head__tags">
          <StatusTag status="self" text="字幕 · 文字替代" />
        </view>
      </view>

      <!-- 推荐理由 -->
      <AppNotice type="info">
        为什么推荐给你：{{ detail.applicable_scope || '与你的记录相关' }}。示意图不是你的真实病变，不能据此判断本人病因。
      </AppNotice>

      <!-- 适用范围 -->
      <AppCard>
        <text class="card-title">适用范围</text>
        <view class="scope-row">
          <text class="scope-row__label">适用</text>
          <text class="scope-row__value">{{ applicable.join('、') || '尚未确认' }}</text>
        </view>
        <view class="scope-row">
          <text class="scope-row__label">不适用</text>
          <text class="scope-row__value">{{ notApplicable.join('、') || '报告未提及' }}</text>
        </view>
      </AppCard>

      <!-- 文字替代（全文） -->
      <AppCard>
        <view class="card-head" hover-class="card-head--hover" :hover-stay-time="80" @click="subtitleExpanded = !subtitleExpanded">
          <text class="card-title">文字替代（全文）</text>
          <AppIcon :name="subtitleExpanded ? 'back' : 'arrow-right'" :size="18" />
        </view>
        <text v-if="subtitleExpanded" class="subtitle-text">{{ subtitleText || '尚未提供文字替代' }}</text>
        <text v-else class="subtitle-text subtitle-text--collapsed">{{ subtitleText || '尚未提供文字替代' }}</text>
      </AppCard>

      <!-- 复述任务 -->
      <AppCard class="retell-card">
        <text class="card-title">看完后，用一句话说说你理解了什么（可选）</text>
        <text class="retell-card__note">这用来检查视频有没有造成新的误解，不是考试，也不会影响你的分析结果。</text>
        <view class="retell-card__box">
          <textarea
            v-model="retelling"
            class="retell-card__textarea"
            placeholder="例如：L5/S1 是腰椎最下面那个椎间盘的位置…"
            placeholder-class="retell-card__textarea-placeholder"
            :maxlength="200"
            :disabled="retellDone"
          />
        </view>
        <AppButton v-if="!retellDone" type="primary" @click="onRetell">提交</AppButton>
        <text v-else class="retell-card__done">已收到你的复述，谢谢。</text>
      </AppCard>

      <!-- 内容反馈 -->
      <AppCard>
        <text class="card-title">这条内容对你有帮助吗？</text>
        <view class="help-chips">
          <view
            v-for="help in ['看懂了', '没看懂', '内容有误（举报）']"
            :key="help"
            class="help-chip"
            :class="{ 'help-chip--selected': helpDone === help }"
            hover-class="help-chip--hover"
            :hover-stay-time="80"
            @click="help === '内容有误（举报）' ? onReportError() : onHelp(help)"
          >
            <text class="help-chip__text">{{ help }}</text>
          </view>
        </view>
      </AppCard>
    </view>
  </view>
</template>

<style lang="scss">
.detail-page {
  min-height: 100vh;
  background-color: $color-bg;
}

.detail-body {
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 播放区 ---------- */
.player {
  background-color: #1b2230;
  border-radius: $radius-card;
  overflow: hidden;
}

.player__stage {
  height: 380rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $spacing-md;
}

.player__play {
  width: 110rpx;
  height: 110rpx;
  border-radius: 50%;
  background-color: $color-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-primary;
}

.player__caption {
  font-size: $font-size-aux;
  color: rgba(255, 255, 255, 0.75);
}

.player__bar {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  padding: $spacing-sm $spacing-md;
  background-color: rgba(0, 0, 0, 0.35);
}

.player__progress {
  flex: 1;
  height: 6rpx;
  border-radius: $radius-pill;
  background-color: rgba(255, 255, 255, 0.3);
}

.player__time {
  font-size: $font-size-tag;
  color: rgba(255, 255, 255, 0.85);
}

.player__cc {
  padding: 2rpx $spacing-xs;
  border-radius: $radius-tag;
  background-color: rgba(255, 255, 255, 0.18);

  &--on {
    background-color: $color-primary;
  }

  &--hover {
    opacity: 0.85;
  }
}

.player__cc-text {
  font-size: $font-size-tag;
  color: $color-surface;
}

/* ---------- 标题与审核信息 ---------- */
.detail-head {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.detail-head__title {
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.4;
}

.detail-head__tags {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-xs;
}

/* ---------- 卡片 ---------- */
.card-title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: $color-text-2;

  &--hover {
    opacity: 0.75;
  }
}

.scope-row {
  display: flex;
  align-items: flex-start;
  gap: $spacing-md;
  padding: $spacing-sm 0;
  border-top: 2rpx solid $color-border;

  &:first-of-type {
    border-top: none;
  }
}

.scope-row__label {
  width: 112rpx;
  flex-shrink: 0;
  font-size: $font-size-body;
  color: $color-text-2;
}

.scope-row__value {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- 文字替代 ---------- */
.subtitle-text {
  display: block;
  margin-top: $spacing-md;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;

  &--collapsed {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
}

/* ---------- 复述任务 ---------- */
.retell-card {
  background-color: $color-primary-light;
  border-color: $color-primary;
}

.retell-card__note {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

.retell-card__box {
  margin: $spacing-md 0;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
}

.retell-card__textarea {
  width: 100%;
  min-height: 140rpx;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;

  &-placeholder {
    color: $color-text-3;
  }
}

.retell-card__done {
  display: block;
  margin-top: $spacing-md;
  font-size: $font-size-body;
  color: $color-primary;
}

/* ---------- 内容反馈 ---------- */
.help-chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

.help-chip {
  min-height: 64rpx;
  padding: $spacing-xs $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-pill;
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

.help-chip__text {
  font-size: $font-size-body;
  color: $color-text-1;
}
</style>
