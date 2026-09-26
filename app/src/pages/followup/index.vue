<script setup lang="ts">
/**
 * A12 复诊摘要预览与导出（设计稿 docs/design/app/A12.png，设计宽度 375，主 Tab）
 *
 * 固定六段；区分自述 / 报告原文 / 医生记录；未核实项保留；
 * 用户预览后自主导出；导出后由用户自行决定是否分享给医生。
 *
 * 数据全部来自 server 接口：
 * - POST /episodes/{id}/followup/generate      生成六段草稿
 * - GET  /episodes/{id}/followup               最新一份摘要
 * - PUT  /episodes/{id}/followup/{summaryId}   预览后纠正
 * - POST /episodes/{id}/followup/{summaryId}/export  导出（文本 / PDF / 图片）
 */
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { useAuthStore } from '../../stores/auth'
import {
  correctFollowup,
  exportFollowup,
  generateFollowup,
  getLatestFollowup,
  QUESTIONS_SECTION_KEY,
  type FollowupSection,
  type FollowupSummaryView,
} from '../../api/followup'
import { listEpisodes } from '../../api/episodes'
import { beijingDate, getStatusBarHeight } from '../../utils/system'

/** 三个页签（按设计稿） */
const TABS = ['一页交接摘要', '问题清单', '带什么'] as const

/** 导出格式 */
const EXPORT_FORMATS = ['PDF', '图片', '文本'] as const

const auth = useAuthStore()
const statusBarHeight = ref(0)

const episodeId = ref('')
const summary = ref<FollowupSummaryView | null>(null)
const loading = ref(true)
const generating = ref(false)
const exporting = ref('')
const tab = ref<(typeof TABS)[number]>('一页交接摘要')
/** 正在编辑的段 key 与该段文本 */
const editingKey = ref('')
const editingText = ref('')

onLoad((options) => {
  const id = (options as { episode_id?: string } | undefined)?.episode_id
  if (typeof id === 'string') episodeId.value = id
})

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  await init()
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

async function init() {
  loading.value = true
  try {
    if (!episodeId.value) {
      const list = await listEpisodes()
      const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
      episodeId.value = active?.id ?? ''
    }
    if (!episodeId.value) {
      summary.value = null
      return
    }
    // 还没有生成过时接口返回 null（空状态，不产生 404 噪音）；不自动生成，由用户主动触发
    summary.value = await getLatestFollowup(episodeId.value).catch(() => null)
  } finally {
    loading.value = false
  }
}

/** 生成复诊摘要 */
async function onGenerate() {
  if (generating.value || !episodeId.value) return
  generating.value = true
  try {
    summary.value = await generateFollowup(episodeId.value)
    toast('已生成复诊交接摘要')
  } catch (e) {
    toast(e instanceof Error ? e.message : '生成失败，请稍后重试')
  } finally {
    generating.value = false
  }
}

/* ---------- 预览后纠正 ---------- */

function onEditSection(section: FollowupSection) {
  editingKey.value = section.key
  editingText.value = section.items.map((i) => i.text).join('\n')
}

function onCancelEdit() {
  editingKey.value = ''
  editingText.value = ''
}

async function onSaveEdit() {
  if (!summary.value) return
  const sections: FollowupSection[] = summary.value.content.sections.map((s) => {
    if (s.key !== editingKey.value) return s
    const lines = editingText.value
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    return {
      ...s,
      items: lines.map((text, i) => ({ ...(s.items[i] ?? { source: '自述' }), text })),
    }
  })
  try {
    summary.value = await correctFollowup(episodeId.value, summary.value.id, { sections })
    editingKey.value = ''
    toast('已保存你的修改（未核实项仍会保留）')
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  }
}

/* ---------- 导出 ---------- */

async function onExport(format: (typeof EXPORT_FORMATS)[number]) {
  if (!summary.value || exporting.value) return
  exporting.value = format
  try {
    const result = await exportFollowup(episodeId.value, summary.value.id, format)
    if (format === '文本') {
      // 复制文本：H5 用剪贴板；失败时展示文本供手动复制
      uni.setClipboardData({
        data: result.text,
        success: () => toast('摘要文本已复制到剪贴板'),
        fail: () => toast('复制失败，请长按文本手动复制'),
      })
    } else {
      toast(format === 'PDF' ? '请在打印对话框中选择“另存为 PDF”' : '图片导出由浏览器打印生成')
    }
    summary.value = await getLatestFollowup(episodeId.value)
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败，请稍后重试')
  } finally {
    exporting.value = ''
  }
}

/* ---------- 派生数据 ---------- */

const sections = computed<FollowupSection[]>(() => summary.value?.content.sections ?? [])
const questionSection = computed<FollowupSection | undefined>(() =>
  sections.value.find((s) => s.key === QUESTIONS_SECTION_KEY),
)
const questionCount = computed<number>(() => questionSection.value?.items.length ?? 0)
const generatedLabel = computed<string>(() => {
  const at = summary.value?.content.generated_at
  return at ? beijingDate(at) : ''
})

/** 每条内容的来源与核实状态标签 */
function itemTags(item: { source: string; verify_status?: string }): { key: 'quote' | 'self' | 'unconfirmed' | 'unverified'; text: string }[] {
  const tags: { key: 'quote' | 'self' | 'unconfirmed' | 'unverified'; text: string }[] = []
  if (item.source === '报告原文') tags.push({ key: 'quote', text: '报告原文' })
  else if (item.source === '医生记录') tags.push({ key: 'self', text: '医生记录' })
  else tags.push({ key: 'self', text: '自述' })
  if (item.verify_status === '尚未确认') tags.push({ key: 'unconfirmed', text: '尚未确认' })
  else if (item.verify_status === '未经核实') tags.push({ key: 'unverified', text: '未经核实' })
  return tags
}

/** 侧别不一致提示（报告与自述侧别不同） */
const sideNote = computed<string>(() => {
  const report = sections.value
    .flatMap((s) => s.items)
    .find((i) => i.source === '报告原文' && /(左|右)侧/.test(i.text))
  const self = sections.value
    .flatMap((s) => s.items)
    .find((i) => i.source === '自述' && /(左|右)侧/.test(i.text))
  if (!report || !self) return ''
  const r = /(左|右)侧/.exec(report.text)?.[0]
  const s = /(左|右)侧/.exec(self.text)?.[0]
  return r && s && r !== s ? `报告为“${r}”，你的描述为“${s}”，需向医生确认` : ''
})
</script>

<template>
  <view class="page followup-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <text class="nav__title">复诊准备</text>
        <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80" @click="onExport('文本')">
          <AppIcon name="upload" :size="22" />
        </view>
      </view>
    </view>

    <view v-if="!auth.isLoggedIn" class="followup-body">
      <AppNotice type="info">登录后可以整理复诊摘要。</AppNotice>
    </view>

    <view v-else-if="loading" class="followup-body">
      <AppNotice type="info">正在加载…</AppNotice>
    </view>

    <view v-else-if="!summary" class="followup-body">
      <AppCard>
        <text class="empty-title">还没有复诊摘要</text>
        <text class="empty-desc">系统会按固定六段整理你的病程（自述 / 报告原文 / 医生记录），保留未核实项，你可以预览纠正后自行导出。</text>
        <view class="empty-actions">
          <AppButton type="primary" :loading="generating" @click="onGenerate">生成复诊摘要</AppButton>
        </view>
      </AppCard>
    </view>

    <view v-else class="followup-body">
      <!-- 三个页签 -->
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
          <text class="segmented__text" :class="{ 'segmented__text--active': tab === item }">
            {{ item }}{{ item === '问题清单' && questionCount > 0 ? ` (${questionCount})` : '' }}
          </text>
        </view>
      </view>

      <!-- 一页交接摘要 -->
      <block v-if="tab === '一页交接摘要'">
        <AppCard>
          <text class="summary-title">复诊交接摘要</text>
          <text class="summary-meta">
            成于 {{ generatedLabel }} · 由用户自述与报告原文整理 · 未经医生核实
          </text>

          <view v-for="section in sections" :key="section.key" class="section">
            <view class="section__head">
              <text class="section__title">{{ section.title }}</text>
              <view
                v-if="editingKey !== section.key"
                class="section__edit"
                hover-class="section__edit--hover"
                :hover-stay-time="80"
                @click="onEditSection(section)"
              >
                <AppIcon name="edit" :size="16" />
                <text class="section__edit-text">纠正</text>
              </view>
            </view>

            <!-- 浏览态 -->
            <block v-if="editingKey !== section.key">
              <view v-for="(item, i) in section.items" :key="i" class="section__item">
                <text class="section__item-text">{{ item.text }}</text>
                <view class="section__item-tags">
                  <StatusTag v-for="(tag, j) in itemTags(item)" :key="j" :status="tag.key" :text="tag.text" />
                </view>
              </view>
              <view v-if="section.items.length === 0" class="section__empty">
                <text class="section__empty-text">尚未确认</text>
              </view>
            </block>

            <!-- 编辑态 -->
            <view v-else class="section__editor">
              <textarea
                v-model="editingText"
                class="section__textarea"
                placeholder="每行一条"
                placeholder-class="section__textarea-placeholder"
                :maxlength="2000"
              />
              <view class="section__editor-actions">
                <AppButton type="secondary" @click="onCancelEdit">取消</AppButton>
                <AppButton type="primary" @click="onSaveEdit">保存</AppButton>
              </view>
            </view>
          </view>

          <!-- 侧别不一致提示 -->
          <view v-if="sideNote" class="side-note">
            <AppIcon name="alert" :size="16" />
            <text class="side-note__text">{{ sideNote }}</text>
          </view>

          <!-- 摘要说明 -->
          <view class="summary-foot">
            <view class="summary-foot__icon">
              <AppIcon name="info" :size="18" />
            </view>
            <text class="summary-foot__text">
              本摘要整理已有信息，保留时间来源与未核实项，不含诊断结论。
            </text>
          </view>
        </AppCard>
      </block>

      <!-- 问题清单 -->
      <block v-else-if="tab === '问题清单'">
        <AppCard>
          <text class="summary-title">想请医生确认的问题</text>
          <view v-if="questionCount > 0" class="question-list">
            <view v-for="(item, i) in questionSection?.items" :key="i" class="question-item">
              <view class="question-item__index">
                <text class="question-item__index-text">{{ i + 1 }}</text>
              </view>
              <text class="question-item__text">{{ item.text }}</text>
            </view>
          </view>
          <view v-else class="section__empty">
            <text class="section__empty-text">问题清单为空：可在问与解释或一页分析中加入问题</text>
          </view>
        </AppCard>
      </block>

      <!-- 带什么 -->
      <block v-else>
        <AppCard>
          <text class="summary-title">复诊时可以带上</text>
          <view class="bring-list">
            <view class="bring-item">
              <AppIcon name="check" :size="16" />
              <text class="bring-item__text">已录入的检查报告原文</text>
            </view>
            <view class="bring-item">
              <AppIcon name="check" :size="16" />
              <text class="bring-item__text">症状开始时间与最近变化记录</text>
            </view>
            <view class="bring-item">
              <AppIcon name="check" :size="16" />
              <text class="bring-item__text">正在使用的药物与既有医嘱</text>
            </view>
            <view class="bring-item">
              <AppIcon name="check" :size="16" />
              <text class="bring-item__text">本页导出的一页交接摘要</text>
            </view>
          </view>
        </AppCard>
      </block>

      <!-- 导出操作 -->
      <view class="export-row">
        <AppButton type="primary" :loading="exporting === 'PDF'" @click="onExport('PDF')">导出 PDF</AppButton>
        <AppButton type="secondary" :loading="exporting === '图片'" @click="onExport('图片')">生成图片</AppButton>
        <AppButton type="secondary" :loading="exporting === '文本'" @click="onExport('文本')">复制文本</AppButton>
      </view>

      <AppNotice type="info">
        导出后由你自行决定是否分享给医生；本产品不会主动把你的健康资料发送给任何第三方。
      </AppNotice>
    </view>

    <TabBar />
  </view>
</template>

<style lang="scss">
.followup-page {
  min-height: 100vh;
  background-color: $color-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 120rpx);
}

.followup-body {
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

/* ---------- 摘要卡 ---------- */
.summary-title {
  display: block;
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.summary-meta {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
}

.section {
  padding: $spacing-lg 0;
  border-top: 2rpx solid $color-border;

  &:first-of-type {
    border-top: none;
    padding-top: $spacing-lg;
  }
}

.section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.section__edit {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  color: $color-primary;

  &--hover {
    opacity: 0.7;
  }
}

.section__edit-text {
  font-size: $font-size-aux;
  color: $color-primary;
}

.section__item {
  margin-top: $spacing-sm;
}

.section__item-text {
  display: block;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.section__item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-xs;
  margin-top: $spacing-xs;
}

.section__empty {
  margin-top: $spacing-sm;
}

.section__empty-text {
  font-size: $font-size-body;
  color: $color-text-3;
}

/* ---------- 编辑态 ---------- */
.section__editor {
  margin-top: $spacing-sm;
}

.section__textarea {
  width: 100%;
  min-height: 180rpx;
  padding: $spacing-md;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
  box-sizing: border-box;

  &-placeholder {
    color: $color-text-3;
  }
}

.section__editor-actions {
  display: flex;
  gap: $spacing-md;
  margin-top: $spacing-sm;

  > view {
    flex: 1;
  }
}

/* ---------- 侧别提示 ---------- */
.side-note {
  display: flex;
  align-items: center;
  gap: $spacing-xs;
  margin-top: $spacing-lg;
  padding: $spacing-sm $spacing-md;
  background-color: $color-warn-light;
  border-radius: $radius-button;
  color: $color-warn;
}

.side-note__text {
  flex: 1;
  font-size: $font-size-aux;
  color: $color-warn;
  line-height: $line-height-body;
}

/* ---------- 摘要脚注 ---------- */
.summary-foot {
  display: flex;
  align-items: flex-start;
  gap: $spacing-xs;
  margin-top: $spacing-lg;
  padding: $spacing-md;
  background-color: $color-bg;
  border-radius: $radius-button;
}

.summary-foot__icon {
  color: $color-text-2;
  flex-shrink: 0;
}

.summary-foot__text {
  flex: 1;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 问题清单 ---------- */
.question-list {
  margin-top: $spacing-md;
}

.question-item {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  padding: $spacing-sm 0;
  border-top: 2rpx solid $color-border;

  &:first-child {
    border-top: none;
  }
}

.question-item__index {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background-color: $color-primary-light;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.question-item__index-text {
  font-size: $font-size-tag;
  color: $color-primary;
  font-weight: $font-weight-medium;
}

.question-item__text {
  flex: 1;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

/* ---------- 带什么 ---------- */
.bring-list {
  margin-top: $spacing-md;
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
}

.bring-item {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  color: $color-ok;
}

.bring-item__text {
  font-size: $font-size-body;
  color: $color-text-1;
}

/* ---------- 导出 ---------- */
.export-row {
  display: flex;
  gap: $spacing-sm;

  > view {
    flex: 1;
  }
}

/* ---------- 空状态 ---------- */
.empty-title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.empty-desc {
  display: block;
  margin-top: $spacing-sm;
  font-size: $font-size-body;
  color: $color-text-2;
  line-height: $line-height-body;
}

.empty-actions {
  margin-top: $spacing-lg;
}
</style>
