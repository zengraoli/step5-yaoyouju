<script setup lang="ts">
/**
 * A08 原文对照（设计稿 docs/design/app/A08.png，设计宽度 375）
 *
 * 解释与原文逐句对应；高亮引用；「报告未提及」≠「已排除」。
 *
 * 数据全部来自 server 接口：
 * - GET /analyses/{id}            解释段（含引用）
 * - GET /episodes/{id}/structured 报告原文与术语位置
 */
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import { getAnalysis, type AnalysisView, type ExplainItem } from '../../api/analyses'
import { getStructured, type ExtractedTerm, type StructuredItem } from '../../api/reports'
import { getStatusBarHeight } from '../../utils/system'

const UNCONFIRMED = '尚未确认'

/** 两个页签（按设计稿） */
const TABS = ['按解释查看', '按术语查看'] as const

const statusBarHeight = ref(0)
const analysisId = ref('')
const explainIndex = ref(0)
const tab = ref<(typeof TABS)[number]>('按解释查看')

const analysis = ref<AnalysisView | null>(null)
const items = ref<StructuredItem[]>([])
const errorText = ref('')

onLoad((options) => {
  analysisId.value = typeof options?.analysis_id === 'string' ? options.analysis_id : ''
  const idx = Number(options?.index ?? 0)
  explainIndex.value = Number.isFinite(idx) && idx >= 0 ? idx : 0
})

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  await load()
})

async function load() {
  if (!analysisId.value) {
    errorText.value = '缺少分析信息，请从一页分析页进入'
    return
  }
  try {
    analysis.value = await getAnalysis(analysisId.value)
    const structured = await getStructured(analysis.value.episode_id)
    items.value = structured.items
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '数据加载失败，请稍后重试'
  }
}

/* ---------- 派生数据 ---------- */

const reportItem = computed<StructuredItem | undefined>(() => items.value.find((i) => i.report))
const reportRawText = computed<string>(() => reportItem.value?.raw_text ?? '')
const reportDate = computed<string>(() => reportItem.value?.report?.report_date ?? '')
const terms = computed<ExtractedTerm[]>(() => reportItem.value?.report?.extracted_terms ?? [])

/** 当前解释 */
const currentExplain = computed<ExplainItem | undefined>(
  () => analysis.value?.sections.explain[explainIndex.value],
)

/** 症状摘要中用户描述的侧别（与报告侧别不一致时高亮提醒） */
const selfSide = computed<string>(() => {
  const symptom = items.value.find((i) => i.event_type === '症状')
  if (!symptom?.raw_text) return ''
  const line = symptom.raw_text.split('\n').find((l) => l.trim().startsWith('3.'))
  if (!line) return ''
  const answer = line.slice(line.indexOf('？') + 1)
  const m = /(左|右)侧/.exec(answer)
  return m ? `${m[1]}侧` : ''
})

/** 报告中提到的侧别 */
const reportSide = computed<string>(() => {
  const m = /(左|右)侧/.exec(reportRawText.value)
  return m ? `${m[1]}侧` : ''
})

/** 侧别不一致（需确认） */
const sideMismatch = computed<boolean>(
  () => Boolean(reportSide.value) && Boolean(selfSide.value) && reportSide.value !== selfSide.value,
)

/** 本解释引用到的术语（在报告原文中出现、且解释文字也提到） */
const citedTerms = computed<ExtractedTerm[]>(() => {
  const text = currentExplain.value?.text ?? ''
  return terms.value.filter((t) => text.includes(t.term))
})

/** 侧别不一致时，报告中与该侧别相关的术语（高亮提醒） */
const mismatchTerms = computed<ExtractedTerm[]>(() => {
  if (!sideMismatch.value || !reportSide.value) return []
  const sideChar = reportSide.value.slice(0, 1)
  return terms.value.filter((t) => t.term.includes(sideChar) || citedTerms.value.includes(t))
})

/** 对应原文行号：取本解释提到的第一个术语在原文中的行 */
const citedLine = computed<number>(() => {
  const term = citedTerms.value[0]
  if (!term) return 0
  return reportRawText.value.slice(0, term.start).split('\n').length
})

/** 原文片段（按行拆分，用于高亮渲染） */
const reportLines = computed<string[]>(() => reportRawText.value.split('\n'))

/** 某一行是否需要高亮（本解释引用 / 侧别不一致） */
function lineHighlight(lineIndex: number): 'cited' | 'mismatch' | '' {
  let start = 0
  for (let i = 0; i < lineIndex; i += 1) start += reportLines.value[i].length + 1
  const lineStart = start
  const lineEnd = start + reportLines.value[lineIndex].length
  const inRange = (t: ExtractedTerm) => t.start < lineEnd && t.end > lineStart
  if (mismatchTerms.value.some(inRange)) return 'mismatch'
  if (citedTerms.value.some(inRange)) return 'cited'
  return ''
}

function onTabChange(index: number) {
  tab.value = TABS[index]
}

/** 切换上一条 / 下一条解释 */
function onSwitchExplain(delta: number) {
  const total = analysis.value?.sections.explain.length ?? 0
  if (total === 0) return
  explainIndex.value = (explainIndex.value + delta + total) % total
}

function onBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/index/index' }),
  })
}
</script>

<template>
  <view class="page report-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">原文对照</text>
      </view>
    </view>

    <view class="report-body">
      <!-- 两个页签 -->
      <view class="segmented">
        <view
          v-for="(item, index) in TABS"
          :key="item"
          class="segmented__item"
          :class="{ 'segmented__item--active': tab === item }"
          hover-class="segmented__item--hover"
          :hover-stay-time="80"
          @click="onTabChange(index)"
        >
          <text class="segmented__text" :class="{ 'segmented__text--active': tab === item }">{{ item }}</text>
        </view>
      </view>

      <AppNotice v-if="errorText" type="warn">{{ errorText }}</AppNotice>

      <!-- 按解释查看 -->
      <block v-if="tab === '按解释查看'">
        <AppCard v-if="currentExplain" class="explain-card">
          <view class="explain-card__head">
            <text class="explain-card__index">解释 ②-{{ explainIndex + 1 }}</text>
            <text v-if="citedLine" class="explain-card__line">对应原文：第 {{ citedLine }} 行</text>
          </view>
          <text class="explain-card__text">{{ currentExplain.text }}</text>
          <view class="explain-card__switch">
            <view class="explain-card__arrow" hover-class="explain-card__arrow--hover" :hover-stay-time="80" @click="onSwitchExplain(-1)">
              <AppIcon name="back" :size="16" />
            </view>
            <text class="explain-card__count">
              {{ explainIndex + 1 }} / {{ analysis?.sections.explain.length ?? 0 }}
            </text>
            <view class="explain-card__arrow" hover-class="explain-card__arrow--hover" :hover-stay-time="80" @click="onSwitchExplain(1)">
              <AppIcon name="arrow-right" :size="16" />
            </view>
          </view>
        </AppCard>

        <!-- 报告原文 -->
        <AppCard v-if="reportItem">
          <view class="report-card__head">
            <AppIcon name="file" :size="18" />
            <text class="report-card__title">报告原文 · {{ reportDate }} · 腰椎MRI</text>
            <view class="report-card__tag">
              <text class="report-card__tag-text">未修改</text>
            </view>
          </view>
          <view class="report-card__body">
            <text
              v-for="(line, i) in reportLines"
              :key="i"
              class="report-card__line"
              :class="{
                'report-card__line--cited': lineHighlight(i) === 'cited',
                'report-card__line--mismatch': lineHighlight(i) === 'mismatch',
              }"
            >{{ line }}</text>
          </view>
          <view class="report-card__legend">
            <view class="legend-item">
              <view class="legend-dot legend-dot--cited" />
              <text class="legend-item__text">本解释引用</text>
            </view>
            <view v-if="sideMismatch" class="legend-item">
              <view class="legend-dot legend-dot--mismatch" />
              <text class="legend-item__text">与你描述侧别不一致，需确认</text>
            </view>
          </view>
        </AppCard>
        <AppCard v-else>
          <text class="empty-hint__text">还没有录入报告原文（{{ UNCONFIRMED }}）。</text>
        </AppCard>

        <!-- 本段涉及的术语 -->
        <AppCard>
          <text class="terms-card__title">本段涉及的术语</text>
          <view class="terms-list">
            <view v-for="(term, i) in citedTerms" :key="i" class="term-row">
              <text class="term-row__term">{{ term.term }}</text>
              <text class="term-row__meaning">{{ term.meaning }}</text>
            </view>
          </view>
          <view v-if="citedTerms.length === 0" class="empty-hint">
            <text class="empty-hint__text">本段解释没有对应到报告中的术语。</text>
          </view>
        </AppCard>

        <AppNotice type="warn">
          报告中没有描述的内容（例如是否存在神经根水肿）不会被写成“已排除”，而会标为“报告未提及”。
        </AppNotice>
      </block>

      <!-- 按术语查看 -->
      <block v-else>
        <AppCard>
          <text class="terms-card__title">报告中的术语</text>
          <view class="terms-list">
            <view v-for="(term, i) in terms" :key="i" class="term-row">
              <view class="term-row__head">
                <text class="term-row__term">{{ term.term }}</text>
                <text class="term-row__pos">原文第{{ reportRawText.slice(0, term.start).split('\n').length }}行</text>
              </view>
              <text class="term-row__meaning">{{ term.meaning }}</text>
            </view>
          </view>
          <view v-if="terms.length === 0" class="empty-hint">
            <text class="empty-hint__text">报告原文中没有识别到术语（{{ UNCONFIRMED }}）。</text>
          </view>
        </AppCard>

        <AppCard v-if="reportItem">
          <view class="report-card__head">
            <AppIcon name="file" :size="18" />
            <text class="report-card__title">报告原文 · {{ reportDate }}</text>
          </view>
          <view class="report-card__body">
            <text
              v-for="(line, i) in reportLines"
              :key="i"
              class="report-card__line"
              :class="{
                'report-card__line--cited': lineHighlight(i) === 'cited',
                'report-card__line--mismatch': lineHighlight(i) === 'mismatch',
              }"
            >{{ line }}</text>
          </view>
        </AppCard>

        <AppNotice type="warn">
          报告中没有描述的内容（例如是否存在神经根水肿）不会被写成“已排除”，而会标为“报告未提及”。
        </AppNotice>
      </block>
    </view>

    <!-- 底部操作 -->
    <view class="report-footer">
      <AppButton type="secondary" block @click="onBack">返回一页分析</AppButton>
    </view>
  </view>
</template>

<style lang="scss">
.report-page {
  min-height: 100vh;
  background-color: $color-bg;
}

.report-body {
  padding: $spacing-lg $spacing-page 0;
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

/* ---------- 解释卡 ---------- */
.explain-card {
  background-color: $color-primary-light;
  border-color: $color-primary;
}

.explain-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.explain-card__index {
  font-size: $font-size-aux;
  color: $color-primary;
  font-weight: $font-weight-medium;
}

.explain-card__line {
  font-size: $font-size-aux;
  color: $color-text-2;
}

.explain-card__text {
  display: block;
  margin-top: $spacing-sm;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.explain-card__switch {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-lg;
  margin-top: $spacing-md;
}

.explain-card__arrow {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background-color: $color-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-primary;

  &--hover {
    opacity: 0.8;
  }
}

.explain-card__count {
  font-size: $font-size-aux;
  color: $color-text-2;
}

/* ---------- 报告原文 ---------- */
.report-card__head {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  color: $color-info;
}

.report-card__title {
  flex: 1;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.report-card__tag {
  padding: 2rpx $spacing-xs;
  background-color: $color-neutral-light;
  border-radius: $radius-tag;
}

.report-card__tag-text {
  font-size: $font-size-tag;
  color: $color-text-2;
}

.report-card__body {
  margin-top: $spacing-md;
  padding: $spacing-md;
  background-color: $color-bg;
  border-radius: $radius-button;
}

.report-card__line {
  display: block;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: 1.8;

  &--cited {
    color: $color-primary;
    font-weight: $font-weight-medium;
  }

  &--mismatch {
    color: $color-warn;
    font-weight: $font-weight-medium;
  }
}

.report-card__legend {
  display: flex;
  gap: $spacing-lg;
  margin-top: $spacing-md;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
}

.legend-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;

  &--cited {
    background-color: $color-primary;
  }

  &--mismatch {
    background-color: $color-warn;
  }
}

.legend-item__text {
  font-size: $font-size-aux;
  color: $color-text-2;
}

/* ---------- 术语 ---------- */
.terms-card__title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  margin-bottom: $spacing-md;
}

.terms-list {
  display: flex;
  flex-direction: column;
}

.term-row {
  padding: $spacing-md 0;
  border-top: 2rpx solid $color-border;

  &:first-child {
    border-top: none;
    padding-top: 0;
  }
}

.term-row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.term-row__term {
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  color: $color-primary;
}

.term-row__pos {
  font-size: $font-size-tag;
  color: $color-info;
  padding: 2rpx $spacing-xs;
  background-color: $color-info-light;
  border-radius: $radius-tag;
}

.term-row__meaning {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
}

.empty-hint {
  padding: $spacing-sm 0;
}

.empty-hint__text {
  font-size: $font-size-body;
  color: $color-text-3;
}

/* ---------- 底部 ---------- */
.report-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  background-color: $color-surface;
  border-top: 2rpx solid $color-border;
}
</style>
