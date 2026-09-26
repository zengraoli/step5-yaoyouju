<script setup lang="ts">
/**
 * A02 当前关键变化确认（设计稿 docs/design/app/A02.png，设计宽度 375，第 1/4 步）
 *
 * 结构：自定义导航栏（返回 + 标题 + 步骤）→ 引导语 → 四道低负担题目
 *       （症状变化 / 需要医生及时评估的情况多选 / 涉及侧别 / 大约开始时间）→
 *       「下一步」+「先看已审核科普，稍后再填」。
 *
 * 产品红线：
 * - 缺失不默认阴性：没有回答的问题记录为「尚未确认」，事件 verify_status 一律「尚未确认」；
 * - 红旗项优先：勾选「会阴区或鞍区麻木 / 双腿进行性无力 / 大小便控制异常」等选项时，
 *   选中即跳转就医提示页（A03），不被登录、后续题目或提交流程阻断；
 * - 停止个性化分析：提交时 POST /analyses 命中红旗（40910/40911）同样走 A03 分支。
 *
 * 数据全部来自 server 接口，不写死在页面里：
 * - GET  /episodes                 取进行中的病程（没有则创建，起病时间取第 4 题）
 * - POST /episodes/{id}/events     写入结构化摘要（event_type=症状，source_type=自述）
 * - POST /analyses                 提交分析（命中红旗返回 40910/40911 + 就医提示 data）
 */
import { onMounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppChip from '../../components/AppChip.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import { useAuthStore } from '../../stores/auth'
import { addCareEvent, createEpisode, listEpisodes } from '../../api/episodes'
import { createAnalysis, safetyNoticeFromError } from '../../api/analyses'
import {
  RED_FLAG_NONE_KEY,
  RED_FLAG_OPTIONS,
  RED_FLAG_UNSURE_KEY,
  hasHighSeverity,
  matchTextsOfKeys,
  signalsOfKeys,
} from '../../utils/redflag'
import { beijingToday, getStatusBarHeight } from '../../utils/system'

/** 第 1 题选项（单选；「尚未确认」是显式选项，未选即未回答） */
const CHANGE_OPTIONS = ['加重', '差不多', '减轻', '尚未确认'] as const
/** 第 3 题选项（单选） */
const SIDE_OPTIONS = ['左侧', '右侧', '双侧', '尚未确认'] as const
/** 第 4 题快速选项（单选，与具体日期互斥） */
const ONSET_OPTIONS = ['记不清', '约1周内', '约1个月内', '超过3个月'] as const

/** 四道题的补充说明键 */
type NoteKey = 'change' | 'redflag' | 'side' | 'onset'
const NOTE_KEYS: NoteKey[] = ['change', 'redflag', 'side', 'onset']

/** 第 2 题全部选项的展示文案（含两个非红旗选项） */
const RED_FLAG_LABELS: Record<string, string> = {
  ...Object.fromEntries(RED_FLAG_OPTIONS.map((o) => [o.key, o.label])),
  [RED_FLAG_NONE_KEY]: '以上都没有',
  [RED_FLAG_UNSURE_KEY]: '不确定 / 记不清',
}

const auth = useAuthStore()
const statusBarHeight = ref(0)

/** 第 1 题：与上次记录相比的变化（空 = 未回答，不默认阴性） */
const change = ref('')
/** 第 2 题：需要医生及时评估的情况（多选） */
const redFlags = ref<string[]>([])
/** 第 3 题：疼痛或麻木主要涉及哪一侧 */
const side = ref('')
/** 第 4 题：这次症状大约从什么时候开始（具体日期或快速选项） */
const onsetDate = ref('')
const onsetChip = ref('')

/** 每题的补充说明（选填，展开后输入） */
const notes = ref<Record<NoteKey, string>>({ change: '', redflag: '', side: '', onset: '' })
const noteOpen = ref<Record<NoteKey, boolean>>({
  change: false,
  redflag: false,
  side: false,
  onset: false,
})

const submitting = ref(false)
const skipping = ref(false)

onMounted(() => {
  statusBarHeight.value = getStatusBarHeight()
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/* ---------- 选择交互 ---------- */

function onPickChange(option: string) {
  change.value = change.value === option ? '' : option
}

/** 第 2 题多选：「以上都没有」与其它选项互斥；选中红旗项即触发就医提示 */
function onToggleRedFlag(key: string) {
  const adding = !redFlags.value.includes(key)
  let next: string[]
  if (key === RED_FLAG_NONE_KEY) {
    next = adding ? [RED_FLAG_NONE_KEY] : []
  } else {
    const others = redFlags.value.filter((k) => k !== RED_FLAG_NONE_KEY)
    next = adding ? [...others, key] : others.filter((k) => k !== key)
  }
  redFlags.value = next
  if (adding && RED_FLAG_OPTIONS.some((o) => o.key === key)) {
    // 红旗优先：选中即提示就医，不被登录 / 后续题目 / 提交流程阻断
    goNotice(signalsOfKeys(next), hasHighSeverity(next))
  }
}

function onPickSide(option: string) {
  side.value = side.value === option ? '' : option
}

function onPickOnset(option: string) {
  onsetChip.value = onsetChip.value === option ? '' : option
  if (onsetChip.value) onsetDate.value = ''
}

function onPickDate(event: { detail: { value: string } }) {
  onsetDate.value = event.detail.value
  onsetChip.value = ''
}

function toggleNote(key: NoteKey) {
  noteOpen.value[key] = !noteOpen.value[key]
}

/* ---------- 提交 / 跳过 ---------- */

/** 取进行中的病程；没有则按第 4 题答案创建（缺失不默认阴性） */
async function ensureEpisode(): Promise<string> {
  const list = await listEpisodes()
  const active = list.find((e) => e.status === '进行中') ?? list[0] ?? null
  if (active) return active.id
  const created = await createEpisode({
    title: '我的腰痛病程',
    onset_date: onsetDate.value || null,
    onset_certainty: onsetDate.value ? '已确认' : '尚未确认',
  })
  return created.id
}

/** 结构化摘要：写入病程事件，并作为 POST /analyses 的症状变化参与红旗校验 */
function buildSummary(): string {
  const lines: string[] = ['关键变化确认（自述，尚未确认）：']
  lines.push(`1. 与上次记录相比，最近腰痛或腿部症状有变化吗？${change.value || '尚未确认'}`)
  const flags = redFlags.value.map((key) => RED_FLAG_LABELS[key] ?? key)
  lines.push(`2. 最近是否出现以下任一情况？${flags.length > 0 ? flags.join('、') : '尚未确认'}`)
  lines.push(`3. 疼痛或麻木主要涉及哪一侧？${side.value || '尚未确认'}`)
  lines.push(`4. 这次症状大约从什么时候开始？${onsetDate.value || onsetChip.value || '尚未确认'}`)
  const noteTexts = NOTE_KEYS.map((key) => notes.value[key].trim()).filter((text) => text.length > 0)
  if (noteTexts.length > 0) lines.push(`补充说明：${noteTexts.join('；')}`)
  // 需要医生及时评估的信号（规范名，供安全规则校验；命中医治提示）
  const matches = matchTextsOfKeys(redFlags.value)
  if (matches.length > 0) lines.push(`需要医生及时评估：${matches.join('、')}`)
  lines.push('未回答的问题记录为「尚未确认」，不当作「没有」。')
  return lines.join('\n')
}

/** 下一步：写入病程事件 → 提交分析（命中红旗走就医提示分支） */
async function onSubmit() {
  if (submitting.value) return
  if (!auth.isLoggedIn) {
    toast('登录后才能把这次确认写入病程')
    goLogin()
    return
  }
  submitting.value = true
  try {
    const episodeId = await ensureEpisode()
    const summary = buildSummary()
    await addCareEvent(episodeId, {
      event_type: '症状',
      source_type: '自述',
      raw_text: summary,
      verify_status: '尚未确认',
      occurred_at: new Date().toISOString(),
    })
    try {
      const result = await createAnalysis({ episode_id: episodeId, symptom_change: summary })
      toast(
        result.status === 'queued'
          ? '已记录这次确认，一页分析任务已提交'
          : '已记录这次确认；个性化分析暂不可用，已改用可用的回退内容',
      )
      goBack()
    } catch (e) {
      // 命中红旗（40910/40911）：响应 data 即就医提示内容，立即展示、不阻断
      const notice = safetyNoticeFromError(e)
      if (notice) {
        goNotice(
          notice.matched.map((m) => m.label),
          notice.matched.some((m) => m.severity === 'high'),
          notice.rule_set_version,
        )
      } else {
        toast(e instanceof Error ? e.message : '提交分析失败，请稍后重试')
      }
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/** 跳过：也记录一条事件（raw_text 记为今天选择跳过，verify_status=尚未确认） */
async function onSkip() {
  if (skipping.value || submitting.value) return
  if (!auth.isLoggedIn) {
    toast('未登录：这次跳过不会保存，未选择的内容也不会当作“没有”')
    goBack()
    return
  }
  skipping.value = true
  try {
    const episodeId = await ensureEpisode()
    await addCareEvent(episodeId, {
      event_type: '症状',
      source_type: '自述',
      raw_text: `关键变化确认：今天选择跳过（${beijingToday()}）。未回答的问题记录为「尚未确认」，不当作「没有」。`,
      verify_status: '尚未确认',
      occurred_at: new Date().toISOString(),
    })
    toast('已记录：今天选择跳过，稍后可以再填')
    goBack()
  } catch (e) {
    toast(e instanceof Error ? e.message : '记录跳过失败，请稍后重试')
  } finally {
    skipping.value = false
  }
}

/* ---------- 导航 ---------- */

/** 跳转就医提示页（A03）：命中的红旗信号通过页面参数传入并展示 */
function goNotice(signals: string[], stopPersonal: boolean, ruleVersion = '') {
  const query = [
    `signals=${encodeURIComponent(signals.join('、'))}`,
    `stop=${stopPersonal ? '1' : '0'}`,
  ]
  if (ruleVersion) query.push(`rule=${encodeURIComponent(ruleVersion)}`)
  uni.navigateTo({ url: `/pages/emergency/notice?${query.join('&')}` })
}

function goBack() {
  uni.navigateBack({
    fail: () => {
      uni.reLaunch({ url: '/pages/index/index' })
    },
  })
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/login' })
}
</script>

<template>
  <view class="page confirm-page">
    <!-- 自定义导航栏（白底：返回 + 标题 + 步骤） -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="goBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">当前关键变化确认</text>
        <view class="nav__step">
          <text class="nav__step-text">第 1/4 步</text>
        </view>
      </view>
    </view>

    <view class="confirm-body">
      <!-- 引导语：低负担录入，缺失不默认阴性 -->
      <AppNotice type="info">
        先确认最近的变化。没有回答的问题会记录为“尚未确认”，不会被当作“没有”。
      </AppNotice>

      <!-- 未登录：仍可勾选红旗项并立即看到就医提示（就医提示不被登录阻断） -->
      <template v-if="!auth.isLoggedIn">
        <view class="gap-md" />
        <AppNotice type="warn" title="未登录：这次确认暂不保存">
          登录后可把这次确认写入病程；勾选到需要医生及时评估的变化时，仍会立即提示就医（无需登录）。
          <view class="gap-sm" />
          <AppButton type="soft" @click="goLogin">去登录 / 注册</AppButton>
        </AppNotice>
      </template>

      <view class="gap-md" />

      <!-- 1. 症状变化（单选） -->
      <AppCard>
        <view class="q-body">
          <text class="q-title">1. 与上次记录相比，最近腰痛或腿部症状有变化吗？</text>
          <view class="gap-sm" />
          <view class="chip-row">
            <AppChip
              v-for="option in CHANGE_OPTIONS"
              :key="option"
              :label="option"
              filled
              :state="change === option ? 'selected' : 'unselected'"
              @click="onPickChange(option)"
            />
          </view>
          <text v-if="!change" class="q-unanswered">未回答，将记录为「尚未确认」</text>
          <view class="note-toggle" hover-class="note-toggle--hover" :hover-stay-time="80" @click="toggleNote('change')">
            <AppIcon :name="noteOpen.change ? 'close' : 'edit'" :size="14" />
            <text class="note-toggle__text">{{ noteOpen.change ? '收起补充说明' : '＋ 补充说明（选填）' }}</text>
          </view>
          <view v-if="noteOpen.change" class="note-box">
            <textarea
              v-model="notes.change"
              class="note-box__control"
              placeholder="补充这次变化的具体情况（选填）"
              placeholder-class="note-box__placeholder"
            />
          </view>
        </view>
      </AppCard>

      <view class="gap-md" />

      <!-- 2. 需要医生及时评估的情况（多选；红旗项选中即提示就医） -->
      <AppCard>
        <view class="q-body">
          <text class="q-title">2. 最近是否出现以下任一情况？（可多选）</text>
          <text class="q-hint">这些变化需要医生及时评估，出现时会优先提示就医。</text>
          <view class="gap-sm" />
          <view
            v-for="option in RED_FLAG_OPTIONS"
            :key="option.key"
            class="option-row"
            :class="{ 'option-row--checked': redFlags.includes(option.key) }"
            hover-class="option-row--hover"
            :hover-stay-time="80"
            @click="onToggleRedFlag(option.key)"
          >
            <view class="option-row__box">
              <AppIcon v-if="redFlags.includes(option.key)" name="check" :size="14" />
            </view>
            <text class="option-row__label">{{ option.label }}</text>
          </view>
          <view
            class="option-row"
            :class="{ 'option-row--checked': redFlags.includes(RED_FLAG_NONE_KEY) }"
            hover-class="option-row--hover"
            :hover-stay-time="80"
            @click="onToggleRedFlag(RED_FLAG_NONE_KEY)"
          >
            <view class="option-row__box">
              <AppIcon v-if="redFlags.includes(RED_FLAG_NONE_KEY)" name="check" :size="14" />
            </view>
            <text class="option-row__label">以上都没有</text>
          </view>
          <view
            class="option-row"
            :class="{ 'option-row--checked': redFlags.includes(RED_FLAG_UNSURE_KEY) }"
            hover-class="option-row--hover"
            :hover-stay-time="80"
            @click="onToggleRedFlag(RED_FLAG_UNSURE_KEY)"
          >
            <view class="option-row__box">
              <AppIcon v-if="redFlags.includes(RED_FLAG_UNSURE_KEY)" name="check" :size="14" />
            </view>
            <text class="option-row__label">不确定 / 记不清</text>
          </view>
          <text v-if="redFlags.length === 0" class="q-unanswered">未回答，将记录为「尚未确认」</text>
          <view class="note-toggle" hover-class="note-toggle--hover" :hover-stay-time="80" @click="toggleNote('redflag')">
            <AppIcon :name="noteOpen.redflag ? 'close' : 'edit'" :size="14" />
            <text class="note-toggle__text">{{ noteOpen.redflag ? '收起补充说明' : '＋ 补充说明（选填）' }}</text>
          </view>
          <view v-if="noteOpen.redflag" class="note-box">
            <textarea
              v-model="notes.redflag"
              class="note-box__control"
              placeholder="补充这些情况出现的时间与变化（选填）"
              placeholder-class="note-box__placeholder"
            />
          </view>
        </view>
      </AppCard>

      <view class="gap-md" />

      <!-- 3. 涉及侧别（单选） -->
      <AppCard>
        <view class="q-body">
          <text class="q-title">3. 疼痛或麻木主要涉及哪一侧？</text>
          <view class="gap-sm" />
          <view class="chip-row">
            <AppChip
              v-for="option in SIDE_OPTIONS"
              :key="option"
              :label="option"
              filled
              :state="side === option ? 'selected' : 'unselected'"
              @click="onPickSide(option)"
            />
          </view>
          <text v-if="!side" class="q-unanswered">未回答，将记录为「尚未确认」</text>
          <view class="note-toggle" hover-class="note-toggle--hover" :hover-stay-time="80" @click="toggleNote('side')">
            <AppIcon :name="noteOpen.side ? 'close' : 'edit'" :size="14" />
            <text class="note-toggle__text">{{ noteOpen.side ? '收起补充说明' : '＋ 补充说明（选填）' }}</text>
          </view>
          <view v-if="noteOpen.side" class="note-box">
            <textarea
              v-model="notes.side"
              class="note-box__control"
              placeholder="补充疼痛或麻木的具体位置（选填）"
              placeholder-class="note-box__placeholder"
            />
          </view>
        </view>
      </AppCard>

      <view class="gap-md" />

      <!-- 4. 大约开始时间（具体日期或快速选项） -->
      <AppCard>
        <view class="q-body">
          <text class="q-title">4. 这次症状大约从什么时候开始？</text>
          <view class="gap-sm" />
          <picker mode="date" :value="onsetDate || beijingToday()" @change="onPickDate">
            <view class="date-box">
              <text class="date-box__text" :class="{ 'date-box__text--empty': !onsetDate }">
                {{ onsetDate || '选择日期，或点“记不清”' }}
              </text>
              <AppIcon class="date-box__icon" name="calendar" :size="20" />
            </view>
          </picker>
          <view class="gap-sm" />
          <view class="chip-row">
            <AppChip
              v-for="option in ONSET_OPTIONS"
              :key="option"
              :label="option"
              filled
              :state="onsetChip === option ? 'selected' : 'unselected'"
              @click="onPickOnset(option)"
            />
          </view>
          <text v-if="!onsetDate && !onsetChip" class="q-unanswered">未回答，将记录为「尚未确认」</text>
          <view class="note-toggle" hover-class="note-toggle--hover" :hover-stay-time="80" @click="toggleNote('onset')">
            <AppIcon :name="noteOpen.onset ? 'close' : 'edit'" :size="14" />
            <text class="note-toggle__text">{{ noteOpen.onset ? '收起补充说明' : '＋ 补充说明（选填）' }}</text>
          </view>
          <view v-if="noteOpen.onset" class="note-box">
            <textarea
              v-model="notes.onset"
              class="note-box__control"
              placeholder="补充起病经过，如外伤、受凉、久坐后出现（选填）"
              placeholder-class="note-box__placeholder"
            />
          </view>
        </view>
      </AppCard>

      <view class="gap-lg" />

      <!-- 提交 / 跳过 -->
      <AppButton type="primary" block :loading="submitting" @click="onSubmit">下一步</AppButton>
      <view
        class="confirm-skip"
        :class="{ 'confirm-skip--busy': submitting || skipping }"
        hover-class="confirm-skip--hover"
        :hover-stay-time="80"
        @click="onSkip"
      >
        <text class="confirm-skip__text">{{ skipping ? '记录中…' : '先看已审核科普，稍后再填' }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.confirm-page {
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

.nav__step {
  flex: none;
  padding: 4rpx $spacing-sm;
  border-radius: $radius-pill;
  background-color: $color-neutral-light;
}

.nav__step-text {
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: 1.4;
}

.confirm-body {
  padding: $spacing-md $spacing-page $spacing-xxl;
}

/* ---------- 题目卡片 ---------- */
.q-body {
  padding-top: $spacing-md;
}

.q-title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.5;
}

.q-hint {
  display: block;
  margin-top: 2rpx;
  font-size: $font-size-aux-lg;
  color: $color-text-3;
  line-height: 1.5;
}

/* 未回答的题：显式标注「尚未确认」，不默认阴性 */
.q-unanswered {
  display: block;
  margin-top: $spacing-sm;
  font-size: $font-size-aux;
  color: $color-warn;
  line-height: 1.5;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
}

/* ---------- 第 2 题多选项 ---------- */
.option-row {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  min-height: 88rpx;
  padding: 0 $spacing-md;
  border: 1rpx solid $color-border;
  border-radius: $radius-button;
  background-color: $color-surface;

  & + & {
    margin-top: $spacing-sm;
  }
}

.option-row--checked {
  border-color: $color-primary;
  background-color: $color-primary-light;
}

.option-row--hover {
  opacity: 0.85;
}

.option-row__box {
  flex: none;
  width: 36rpx;
  height: 36rpx;
  border: 1rpx solid $color-border;
  border-radius: 8rpx;
  background-color: $color-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-surface;
}

.option-row--checked .option-row__box {
  border-color: $color-primary;
  background-color: $color-primary;
}

.option-row__label {
  flex: 1;
  min-width: 0;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: 1.5;
}

/* ---------- 第 4 题日期选择 ---------- */
.date-box {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  min-height: 88rpx;
  padding: 0 $spacing-md;
  border: 1rpx solid $color-border;
  border-radius: $radius-button;
  background-color: $color-surface;
}

.date-box__text {
  flex: 1;
  min-width: 0;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: 1.5;
}

.date-box__text--empty {
  color: $color-text-3;
}

.date-box__icon {
  flex: none;
  color: $color-text-3;
}

/* ---------- 补充说明（选填，可展开） ---------- */
.note-toggle {
  display: inline-flex;
  align-items: center;
  gap: $spacing-xs;
  margin-top: $spacing-sm;
  min-height: 44rpx;
  padding: $spacing-xs 0;
  color: $color-primary;
}

.note-toggle--hover {
  opacity: 0.7;
}

.note-toggle__text {
  font-size: $font-size-aux;
  color: $color-primary;
  line-height: 1.4;
}

.note-box {
  margin-top: $spacing-xs;
  padding: $spacing-sm $spacing-md;
  border: 1rpx solid $color-border;
  border-radius: $radius-button;
  background-color: $color-bg;
}

.note-box__control {
  width: 100%;
  min-height: 132rpx;
  font-size: $font-size-body;
  color: $color-text-1;
  line-height: $line-height-body;
}

.note-box__placeholder {
  font-size: $font-size-body;
  color: $color-text-3;
}

/* ---------- 底部操作 ---------- */
.confirm-skip {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 88rpx;
  margin-top: $spacing-sm;
  padding: $spacing-sm 0;
}

.confirm-skip--hover {
  opacity: 0.7;
}

.confirm-skip--busy {
  opacity: 0.45;
}

.confirm-skip__text {
  font-size: $font-size-body;
  color: $color-primary;
  line-height: 1.5;
}
</style>
