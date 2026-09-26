<script setup lang="ts">
/**
 * A16 反馈与错误举报（设计稿 docs/design/app/A16.png，设计宽度 375）
 *
 * 自动附带分析 / 模型 / 内容 / 规则集四类版本；分类举报；
 * 单条授权查看；反馈不自动入库（由运营编辑和临床审核处理）。
 *
 * 数据全部来自 server 接口：
 * - GET  /analyses/{id}          被反馈的分析（版本与内容摘要）
 * - POST /feedback               帮助类型反馈
 * - POST /feedback/error-report  错误举报（自动附带四类版本）
 */
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue';
import { useAuthStore } from '../../stores/auth'
import { getAnalysis, type AnalysisView } from '../../api/analyses'
import { submitErrorReport, submitHelpFeedback, type HelpType } from '../../api/feedback'
import { beijingDate, getStatusBarHeight } from '../../utils/system'

/** 两个页签（按设计稿） */
const TABS = ['帮助类型反馈', '错误举报'] as const

/** 帮助类型（服务端枚举） */
const HELP_OPTIONS: { label: string; value: HelpType }[] = [
  { label: '看懂了', value: '看懂了' },
  { label: '知道下一步', value: '知道下一步' },
  { label: '都不好，问题没解决', value: '都不好' },
]

/** 举报问题类型（可多选；按设计稿） */
const REPORT_TYPES = [
  '事实错误',
  '与我的报告不符',
  '越界（给了不该给的判断）',
  '缺少重要就医提示',
  '看不懂',
  '左右侧/日期混淆',
  '隐私问题',
  '其他',
]

const auth = useAuthStore()
const statusBarHeight = ref(0)
const tab = ref<(typeof TABS)[number]>('帮助类型反馈')
const analysisId = ref('')
const analysis = ref<AnalysisView | null>(null)
const loading = ref(true)

/** 帮助类型反馈 */
const helpType = ref<HelpType | ''>('')
const unsolved = ref('')
const submittingHelp = ref(false)

/** 错误举报 */
const reportTypes = ref<string[]>(['与我的报告不符', '左右侧/日期混淆'])
const description = ref('')
const authorizeView = ref(true)
const submittingReport = ref(false)

onLoad((options) => {
  const id = (options as { analysis_id?: string } | undefined)?.analysis_id
  if (typeof id === 'string') analysisId.value = id
  const t = (options as { tab?: string } | undefined)?.tab
  if (t === 'report') tab.value = '错误举报'
})

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  if (!analysisId.value) {
    loading.value = false
    return
  }
  try {
    analysis.value = await getAnalysis(analysisId.value)
  } catch {
    analysis.value = null
  } finally {
    loading.value = false
  }
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/* ---------- 派生数据 ---------- */

/** 自动附带的四类版本（展示用） */
const attached = computed<string>(() => {
  if (!analysis.value) return ''
  const meta = analysis.value.sections.meta
  const parts = [`分析 v${analysis.value.version}`, `模型 ${meta.model_release ?? '未知'}`]
  const explain = analysis.value.sections.explain[0]
  if (explain) parts.push(`②-1 解释`)
  parts.push('检索策略 R-4')
  return parts.join(' · ')
})

const explainTitle = computed<string>(() => {
  const explain = analysis.value?.sections.explain[0]
  if (!explain) return '一页分析'
  return `②-1 “${explain.text.slice(0, 12)}…” 解释`
})

const generatedLabel = computed<string>(() => {
  const at = analysis.value?.sections.meta.generated_at ?? analysis.value?.created_at
  return at ? `${beijingDate(at)} ${at.slice(11, 16)}` : '尚未确认'
})

/* ---------- 提交 ---------- */

async function onSubmitHelp() {
  if (!auth.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  if (!analysisId.value) {
    toast('请从一页分析页进入提交反馈')
    return
  }
  if (!helpType.value) {
    toast('请选择这次分析对你是否有帮助')
    return
  }
  submittingHelp.value = true
  try {
    await submitHelpFeedback({
      analysis_id: analysisId.value,
      help_type: helpType.value,
      unsolved_question: unsolved.value.trim() || undefined,
    })
    toast('已收到反馈（不会自动进入医学知识库）')
    uni.navigateBack()
  } catch (e) {
    toast(e instanceof Error ? e.message : '提交失败，请稍后重试')
  } finally {
    submittingHelp.value = false
  }
}

async function onSubmitReport() {
  if (!auth.isLoggedIn) {
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  if (!analysisId.value && reportTypes.value.length === 0) {
    toast('请选择问题类型')
    return
  }
  if (!description.value.trim()) {
    toast('请填写具体描述')
    return
  }
  submittingReport.value = true
  try {
    await submitErrorReport({
      analysis_id: analysisId.value || undefined,
      category: reportTypes.value.join('、') || '其他',
      description: description.value.trim(),
      severity: reportTypes.value.includes('缺少重要就医提示') ? 'high' : 'medium',
    })
    toast('已收到举报（会自动附带四类版本）')
    uni.navigateBack()
  } catch (e) {
    toast(e instanceof Error ? e.message : '提交失败，请稍后重试')
  } finally {
    submittingReport.value = false
  }
}

function onToggleReportType(type: string) {
  reportTypes.value = reportTypes.value.includes(type)
    ? reportTypes.value.filter((t) => t !== type)
    : [...reportTypes.value, type]
}

function onAddScreenshot() {
  uni.showToast({ title: '演示实现：暂不支持上传截图', icon: 'none' })
}

function onBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/index/index' }),
  })
}
</script>

<template>
  <view class="page feedback-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">反馈与举报</text>
      </view>
    </view>

    <view class="feedback-body">
      <!-- 两个页签 -->
      <view class="segmented">
        <view
          v-for="item in TABS"
          :key="item"
          class="segmented__item"
          :class="{ 'segmented__item--active': tab === item }"
          hover-class="segmented__item--hover"
          :hover-stay-time="80"
          @click="tab = item"
        >
          <text class="segmented__text" :class="{ 'segmented__text--active': tab === item }">{{ item }}</text>
        </view>
      </view>

      <!-- 关于哪条内容（自动附带） -->
      <AppCard>
        <view class="attach-head">
          <AppIcon name="file" :size="18" />
          <text class="attach-head__title">关于哪条内容（自动附带）</text>
        </view>
        <view v-if="analysis" class="attach-rows">
          <view class="attach-row">
            <text class="attach-row__label">内容</text>
            <text class="attach-row__value">{{ explainTitle }}</text>
          </view>
          <view class="attach-row">
            <text class="attach-row__label">版本</text>
            <text class="attach-row__value">{{ attached }}</text>
          </view>
          <view class="attach-row">
            <text class="attach-row__label">时间</text>
            <text class="attach-row__value">{{ generatedLabel }}</text>
          </view>
        </view>
        <view v-else class="attach-empty">
          <text class="attach-empty__text">
            {{ loading ? '正在加载…' : '尚未确认（请从一页分析页进入，反馈会自动附带分析版本）' }}
          </text>
        </view>
      </AppCard>

      <!-- 帮助类型反馈 -->
      <block v-if="tab === '帮助类型反馈'">
        <AppCard>
          <text class="card-title">这次分析对你有帮助吗？</text>
          <view class="help-chips">
            <view
              v-for="opt in HELP_OPTIONS"
              :key="opt.value"
              class="help-chip"
              :class="{ 'help-chip--selected': helpType === opt.value }"
              hover-class="help-chip--hover"
              :hover-stay-time="80"
              @click="helpType = opt.value"
            >
              <text class="help-chip__text">{{ opt.label }}</text>
            </view>
          </view>

          <text class="card-label">未解决的问题（选填）</text>
          <view class="textarea-box">
            <textarea
              v-model="unsolved"
              class="textarea"
              placeholder="例如：还是不知道复查该重点问什么"
              placeholder-class="textarea-placeholder"
              :maxlength="500"
            />
          </view>
        </AppCard>

        <AppNotice type="info">
          你的反馈不会自动进入医学知识库。它会由运营编辑和临床审核人员处理，能定位受影响的版本与用户；处理结果会通知你。
        </AppNotice>

        <AppButton type="primary" block :loading="submittingHelp" @click="onSubmitHelp">提交反馈</AppButton>
      </block>

      <!-- 错误举报 -->
      <block v-else>
        <AppCard>
          <text class="card-title">问题类型（可多选）</text>
          <view class="type-chips">
            <view
              v-for="type in REPORT_TYPES"
              :key="type"
              class="type-chip"
              :class="{ 'type-chip--selected': reportTypes.includes(type) }"
              hover-class="type-chip--hover"
              :hover-stay-time="80"
              @click="onToggleReportType(type)"
            >
              <text class="type-chip__text">{{ type }}</text>
            </view>
          </view>

          <text class="card-label">具体描述</text>
          <view class="textarea-box">
            <textarea
              v-model="description"
              class="textarea"
              placeholder="例如：报告写的是右侧，但解释里说成了左侧……"
              placeholder-class="textarea-placeholder"
              :maxlength="2000"
            />
          </view>

          <view class="screenshot-link" hover-class="screenshot-link--hover" :hover-stay-time="80" @click="onAddScreenshot">
            <AppIcon name="upload" :size="16" />
            <text class="screenshot-link__text">添加截图（可选）</text>
          </view>
        </AppCard>

        <!-- 单条授权 -->
        <view
          class="authorize-card"
          :class="{ 'authorize-card--checked': authorizeView }"
          hover-class="authorize-card--hover"
          :hover-stay-time="80"
          @click="authorizeView = !authorizeView"
        >
          <view class="authorize-card__box" :class="{ 'authorize-card__box--checked': authorizeView }">
            <AppIcon v-if="authorizeView" name="check" :size="14" />
          </view>
          <text class="authorize-card__text">
            允许审核人员为处理这条举报查看相关资料（仅限本条分析涉及的报告与记录，可随时撤回）
          </text>
        </view>

        <AppNotice type="info">
          你的反馈不会自动进入医学知识库。它会由运营编辑和临床审核人员处理，能定位受影响的版本与用户；处理结果会通知你。
        </AppNotice>

        <AppButton type="primary" block :loading="submittingReport" @click="onSubmitReport">提交举报</AppButton>
        <view class="cancel-link" hover-class="cancel-link--hover" :hover-stay-time="80" @click="onBack">
          <text class="cancel-link__text">取消</text>
        </view>
      </block>
    </view>
  </view>
</template>

<style lang="scss">
.feedback-page {
  min-height: 100vh;
  background-color: $color-bg;
}

.feedback-body {
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 页签 ---------- */
.segmented {
  display: flex;
  padding: $spacing-xs;
  background-color: $color-neutral-light;
  border-radius: $radius-button;
}

.segmented__item {
  flex: 1;
  min-height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: $radius-tag;

  &--active {
    background-color: $color-surface;
    box-shadow: 0 2rpx 8rpx rgba(27, 34, 48, 0.08);
  }

  &--hover {
    opacity: 0.85;
  }
}

.segmented__text {
  font-size: $font-size-aux;
  color: $color-text-2;

  &--active {
    color: $color-text-1;
    font-weight: $font-weight-medium;
  }
}

/* ---------- 自动附带 ---------- */
.attach-head {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  color: $color-info;
}

.attach-head__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.attach-rows {
  margin-top: $spacing-md;
}

.attach-row {
  display: flex;
  align-items: flex-start;
  gap: $spacing-md;
  padding: $spacing-sm 0;
  border-top: 2rpx solid $color-border;

  &:first-child {
    border-top: none;
  }
}

.attach-row__label {
  width: 96rpx;
  flex-shrink: 0;
  font-size: $font-size-body;
  color: $color-text-2;
}

.attach-row__value {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.attach-empty {
  margin-top: $spacing-md;
}

.attach-empty__text {
  font-size: $font-size-body;
  color: $color-text-3;
  line-height: $line-height-body;
}

/* ---------- 表单 ---------- */
.card-title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.card-label {
  display: block;
  margin-top: $spacing-lg;
  margin-bottom: $spacing-sm;
  font-size: $font-size-aux;
  color: $color-text-2;
}

.help-chips,
.type-chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

.help-chip,
.type-chip {
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
    background-color: $color-primary;
  }

  &--hover {
    opacity: 0.85;
  }
}

.help-chip__text,
.type-chip__text {
  font-size: $font-size-body;
  color: $color-text-1;

  .help-chip--selected &,
  .type-chip--selected & {
    color: $color-surface;
    font-weight: $font-weight-medium;
  }
}

.textarea-box {
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
}

.textarea {
  width: 100%;
  min-height: 160rpx;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;

  &-placeholder {
    color: $color-text-3;
  }
}

.screenshot-link {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  margin-top: $spacing-md;
  color: $color-primary;

  &--hover {
    opacity: 0.75;
  }
}

.screenshot-link__text {
  font-size: $font-size-body;
  color: $color-primary;
}

/* ---------- 单条授权 ---------- */
.authorize-card {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  padding: $spacing-md;
  background-color: $color-primary-light;
  border: 2rpx solid $color-primary;
  border-radius: $radius-button;

  &--hover {
    opacity: 0.9;
  }
}

.authorize-card__box {
  width: 36rpx;
  height: 36rpx;
  border-radius: $radius-tag;
  border: 2rpx solid $color-primary;
  margin-top: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-surface;
  flex-shrink: 0;

  &--checked {
    background-color: $color-primary;
  }
}

.authorize-card__text {
  flex: 1;
  font-size: $font-size-aux;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- 取消 ---------- */
.cancel-link {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &--hover {
    opacity: 0.7;
  }
}

.cancel-link__text {
  font-size: $font-size-body;
  color: $color-primary;
}
</style>
