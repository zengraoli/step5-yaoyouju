<script setup lang="ts">
/**
 * A05 录入报告与医嘱（设计稿 docs/design/app/A05.png，设计宽度 375，第 3/4 步，可选）
 *
 * 主路径是粘贴文字；拍照提取为模拟 OCR（受「拍照提取」功能开关控制，默认关闭）；
 * 记录来源类型与报告日期；既有医嘱作为「自述」事件保存（来源可见）。
 *
 * 产品红线：
 * - 原文仅用于对照解释，本产品不做影像读片诊断；
 * - 不会把报告中未描述的内容写成「已排除」；
 * - 本步可跳过（跳过不写入任何报告，也不当作「没有报告」）。
 *
 * 数据全部来自 server 接口：
 * - POST /reports                录入报告（自动创建「报告」病程事件）
 * - POST /reports/ocr            拍照提取（模拟 OCR）
 * - POST /episodes/{id}/events   既有医嘱（event_type=医嘱，source_type=自述）
 */
import { computed, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import { useAuthStore } from '../../stores/auth'
import { addCareEvent, createEpisode, listEpisodes } from '../../api/episodes'
import { createReport, ocrReport } from '../../api/reports'
import { beijingToday, getStatusBarHeight } from '../../utils/system'

/** 三个页签（按设计稿） */
const TABS = ['粘贴文字（推荐）', '拍照提取', '暂不录入'] as const
type Tab = (typeof TABS)[number]

/** 检查类型（设计稿下拉） */
const EXAM_TYPES = ['MRI', 'CT', 'X 光', '超声', '其他']

/** 医生建议快捷标签（点击追加到文本域） */
const ADVICE_CHIPS = ['保守治疗', '复查时间', '用药', '手术评估', '康复建议']

const auth = useAuthStore()
const statusBarHeight = ref(0)
statusBarHeight.value = getStatusBarHeight()

const tab = ref<Tab>('粘贴文字（推荐）')
const reportText = ref('')
const reportDate = ref(beijingToday())
const examTypeIndex = ref(0)
const institution = ref('')
const adviceText = ref('')
const ocrLoading = ref(false)
const submitting = ref(false)

const examType = computed(() => EXAM_TYPES[examTypeIndex.value])

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

function onTabChange(index: number) {
  tab.value = TABS[index]
}

function onExamTypeChange(e: { detail: { value: string } }) {
  examTypeIndex.value = Math.max(0, EXAM_TYPES.indexOf(e.detail.value))
}

/** 取进行中的病程；没有则创建（本步不要求起病时间，缺失记「尚未确认」） */
async function ensureEpisode(): Promise<string> {
  const list = await listEpisodes()
  const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
  if (active) return active.id
  const created = await createEpisode({
    title: '我的腰痛病程',
    onset_date: null,
    onset_certainty: '尚未确认',
  })
  return created.id
}

/** 拍照提取（模拟 OCR）：成功后回填到粘贴文字页签 */
async function onOcr() {
  if (ocrLoading.value) return
  ocrLoading.value = true
  try {
    const res = await ocrReport()
    reportText.value = res.text
    tab.value = '粘贴文字（推荐）'
    toast('已提取示例文本，请核对后使用')
  } catch (e) {
    toast(e instanceof Error ? e.message : '拍照提取失败，请直接粘贴报告文字')
  } finally {
    ocrLoading.value = false
  }
}

/** 下一步：核对信息（写入报告与医嘱 → 进入 A06） */
async function onNext() {
  if (submitting.value) return
  if (!auth.isLoggedIn) {
    toast('登录后才能保存报告')
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  submitting.value = true
  try {
    const episodeId = await ensureEpisode()
    const text = reportText.value.trim()
    if (text) {
      await createReport({
        episode_id: episodeId,
        report_date: reportDate.value || null,
        raw_text: text,
        source_type: '报告原文',
      })
    }
    const advice = adviceText.value.trim()
    if (advice) {
      await addCareEvent(episodeId, {
        event_type: '医嘱',
        source_type: '自述',
        raw_text: `医生已经给出的建议（自述转述，尚未核实）：${advice}`,
        verify_status: '尚未确认',
        occurred_at: new Date().toISOString(),
      })
    }
    uni.navigateTo({ url: '/pages/report/verify' })
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/** 跳过：不写入报告，也不当作「没有报告」 */
function onSkip() {
  uni.navigateTo({ url: '/pages/report/verify' })
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
  <view class="page report-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">录入报告与医嘱（可选）</text>
        <view class="nav__step">
          <text class="nav__step-text">第 3/4 步</text>
        </view>
      </view>
    </view>

    <view class="report-body">
      <!-- 三个页签 -->
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

      <!-- 页签一：粘贴文字 -->
      <block v-if="tab === '粘贴文字（推荐）'">
        <view class="card">
          <view class="card__head">
            <text class="card__title">检查报告原文</text>
            <StatusTag status="quote" text="来源：报告原文" />
          </view>
          <textarea
            v-model="reportText"
            class="textarea"
            placeholder="如：腰椎MRI平扫：L4/5椎间盘轻度膨出；L5/S1椎间盘向后突出，相应硬膜囊受压，右侧神经根受压可能…（示例文本，仅用于演示）"
            placeholder-class="textarea__placeholder"
            :maxlength="2000"
          />

          <view class="form-row">
            <view class="form-cell">
              <text class="form-cell__label">报告日期</text>
              <picker mode="date" :value="reportDate" @change="(e: any) => (reportDate = e.detail.value)">
                <view class="picker">
                  <text class="picker__text">{{ reportDate || '选择日期' }}</text>
                  <AppIcon name="calendar" :size="20" />
                </view>
              </picker>
            </view>
            <view class="form-cell">
              <text class="form-cell__label">检查类型</text>
              <picker mode="selector" :range="EXAM_TYPES" :value="examTypeIndex" @change="onExamTypeChange">
                <view class="picker">
                  <text class="picker__text">{{ examType }}</text>
                  <AppIcon name="arrow-right" :size="18" />
                </view>
              </picker>
            </view>
          </view>

          <text class="form-cell__label">检查机构（可选）</text>
          <view class="input-box">
            <input v-model="institution" class="input-box__control" placeholder="如：XX市人民医院" placeholder-class="input-box__placeholder" />
          </view>
        </view>

        <view class="card">
          <view class="card__head">
            <text class="card__title">医生已经给出的建议（可选）</text>
            <StatusTag status="self" text="来源：自述" />
          </view>
          <textarea
            v-model="adviceText"
            class="textarea"
            placeholder="如：医生建议先保守治疗，4周后复查；避免久坐和弯腰负重"
            placeholder-class="textarea__placeholder"
            :maxlength="1000"
          />
          <view class="chips">
            <view
              v-for="chip in ADVICE_CHIPS"
              :key="chip"
              class="chip"
              hover-class="chip--hover"
              :hover-stay-time="80"
              @click="adviceText = adviceText ? `${adviceText}；${chip}` : chip"
            >
              <text class="chip__text">{{ chip }}</text>
            </view>
          </view>
        </view>
      </block>

      <!-- 页签二：拍照提取（模拟 OCR） -->
      <view v-else-if="tab === '拍照提取'" class="card">
        <view class="card__head">
          <text class="card__title">拍照提取（模拟 OCR）</text>
        </view>
        <text class="ocr-tip">
          演示实现：OCR 为模拟结果，只返回示例文本，不会真实识别图片。提取后请逐字核对，主路径始终是粘贴文字。
        </text>
        <AppButton type="secondary" block :loading="ocrLoading" @click="onOcr">开始提取</AppButton>
      </view>

      <!-- 页签三：暂不录入 -->
      <view v-else class="card">
        <view class="card__head">
          <text class="card__title">暂不录入</text>
        </view>
        <text class="ocr-tip">
          没有报告也可以继续。系统只会基于你已经确认的信息生成分析，未录入不会被当作「没有报告」，也不会影响就医提示。
        </text>
      </view>

      <!-- 信息提示条 -->
      <AppNotice type="info">
        原文仅用于对照解释，每个关键解释都可回看原文。本产品不做影像读片诊断，也不会把报告中未描述的内容写成“已排除”。
      </AppNotice>
    </view>

    <!-- 底部操作 -->
    <view class="report-footer">
      <AppButton type="primary" block :loading="submitting" @click="onNext">下一步：核对信息</AppButton>
      <view class="report-footer__skip" hover-class="report-footer__skip--hover" :hover-stay-time="80" @click="onSkip">
        <text class="report-footer__skip-text">跳过，先不录入报告</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.report-page {
  min-height: 100vh;
  background-color: $color-bg;
  display: flex;
  flex-direction: column;
}

.report-body {
  flex: 1;
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

/* ---------- 卡片 ---------- */
.card {
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
  display: flex;
  flex-direction: column;
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $spacing-md;
}

.card__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

/* ---------- 表单 ---------- */
.textarea {
  width: 100%;
  min-height: 220rpx;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
  box-sizing: border-box;

  &__placeholder {
    color: $color-text-3;
  }
}

.form-row {
  display: flex;
  gap: $spacing-md;
  margin-top: $spacing-lg;
}

.form-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.form-cell__label {
  font-size: $font-size-aux;
  color: $color-text-2;
  margin-bottom: $spacing-xs;
}

.picker {
  min-height: 80rpx;
  padding: 0 $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: $color-text-2;
}

.picker__text {
  font-size: $font-size-body;
  color: $color-text-1;
}

.input-box {
  min-height: 80rpx;
  padding: 0 $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  display: flex;
  align-items: center;
}

.input-box__control {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;

  &__placeholder {
    color: $color-text-3;
  }
}

/* ---------- 芯片 ---------- */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
  margin-top: $spacing-md;
}

.chip {
  min-height: 56rpx;
  padding: $spacing-xs $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-pill;
  display: flex;
  align-items: center;
  justify-content: center;

  &--hover {
    opacity: 0.85;
  }
}

.chip__text {
  font-size: $font-size-body;
  color: $color-text-1;
}

/* ---------- 拍照提取提示 ---------- */
.ocr-tip {
  display: block;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
  margin-bottom: $spacing-lg;
}

/* ---------- 底部操作 ---------- */
.report-footer {
  padding: $spacing-lg $spacing-page calc(env(safe-area-inset-bottom) + #{$spacing-lg});
  background-color: $color-surface;
  border-top: 2rpx solid $color-border;
}

.report-footer__skip {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &--hover {
    opacity: 0.7;
  }
}

.report-footer__skip-text {
  font-size: $font-size-body;
  color: $color-primary;
}
</style>
