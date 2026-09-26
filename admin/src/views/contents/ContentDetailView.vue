<script setup lang="ts">
/**
 * B04 内容编辑与审核详情（设计稿 docs/design/admin/B04.png，设计宽度 1440）
 *
 * 左：基本信息 / 脚本对比 / 字幕与文字替代 / 依据与制作；
 * 右：状态流转（双人发布）、审核记录、版本链、引用定位。
 *
 * 数据来自 server 接口：
 * - GET  /admin/contents/{id}              详情
 * - POST /admin/contents/{id}/approve      审核通过（记录审核人与范围）
 * - POST /admin/contents/{id}/reject       退回修改（记录意见）
 * - POST /admin/contents/{id}/publish      发布（需双人确认）
 * - POST /admin/contents/{id}/take-offline 一键下线（引用定位）
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import {
  approveContent,
  getContentDetailAdmin,
  publishContent,
  rejectContent,
  takeOffline,
  type ContentDetail,
} from '@/api/contents'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const contentId = ref('')
const detail = ref<ContentDetail | null>(null)
const loading = ref(true)
const errorText = ref('')

/** 审核表单 */
const reviewScope = ref('医学准确性')
const reviewComment = ref('')
const submitting = ref('')

/** 状态流转步骤（按 system-design.md 第 4 节） */
const FLOW = ['草稿', '待医学审核', '已审定', '已发布']

onMounted(async () => {
  const id = (route.params as { id?: string }).id
  contentId.value = id ?? ''
  if (!contentId.value) {
    errorText.value = '缺少内容 ID'
    loading.value = false
    return
  }
  await load()
})

async function load() {
  loading.value = true
  try {
    detail.value = await getContentDetailAdmin(contentId.value)
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '内容加载失败'
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  globalThis.alert?.(title)
}

function confirmAction(message: string): boolean {
  return globalThis.confirm ? globalThis.confirm(message) : true
}


/** 权限判断（细粒度；服务端同样校验） */
const canReview = computed<boolean>(() => auth.hasPermission('content.review'))
const canPublish = computed<boolean>(() => auth.hasPermission('content.publish'))
const canOffline = computed<boolean>(() => auth.hasPermission('content.offline'))

/** 脚本对比：当前版本与上一版本 */
const scriptDiff = computed<{ current: string; previous: string | null }>(() => {
  const versions = detail.value?.versions ?? []
  const current = versions.find((v) => v.is_current) ?? versions[versions.length - 1]
  const idx = versions.findIndex((v) => v === current)
  const previous = idx > 0 ? versions[idx - 1] : null
  return { current: current?.script ?? '', previous: previous?.script ?? null }
})

async function onApprove() {
  submitting.value = 'approve'
  try {
    await approveContent(contentId.value, {
      review_scope: reviewScope.value,
      comment: reviewComment.value || undefined,
    })
    toast('已审核通过（记录审核人与范围）')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    submitting.value = ''
  }
}

async function onReject() {
  if (!reviewComment.value.trim()) {
    toast('退回必须填写意见')
    return
  }
  submitting.value = 'reject'
  try {
    await rejectContent(contentId.value, reviewComment.value.trim())
    toast('已退回修改（记录意见）')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    submitting.value = ''
  }
}

async function onPublish() {
  submitting.value = 'publish'
  try {
    await publishContent(contentId.value)
    toast('已发布（双人确认通过）')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '发布失败')
  } finally {
    submitting.value = ''
  }
}

async function onTakeOffline() {
  if (!confirmAction('确认一键下线？下线后立即对用户端不可见，并定位引用页面。')) return
  submitting.value = 'offline'
  try {
    const result = (await takeOffline(contentId.value, '审核详情一键下线')) as {
      references?: { count: number; analyses: { analysis_id: string; analysis_version: number }[] };
    };
    const count = result?.references?.count ?? 0
    toast(`已下线；引用分析 ${count} 条`)
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '下线失败')
  } finally {
    submitting.value = ''
  }
}

function onBack() {
  router.push('/contents')
}
</script>

<template>
  <div class="detail-page" v-if="detail">
    <!-- 面包屑 -->
    <div class="breadcrumb">
      <button type="button" class="breadcrumb__link" @click="onBack">内容库</button>
      <span class="breadcrumb__sep">›</span>
      <span class="breadcrumb__current">{{ detail.title }} · v{{ detail.current_version?.version ?? '—' }}（{{ detail.current_status }}）</span>
      <div class="breadcrumb__actions">
        <AppButton type="soft" size="sm">视频</AppButton>
        <StatusTag status="unconfirmed" :text="detail.current_status" />
        <AppButton type="soft" size="sm">v{{ detail.current_version?.version ?? '—' }} · 更正自 v1</AppButton>
      </div>
    </div>

    <div class="detail-grid">
      <!-- 左：基本信息 / 脚本 / 字幕 / 依据 -->
      <div class="detail-main">
        <AppCard class="panel">
          <h2 class="panel__title">基本信息</h2>
          <div class="form-grid">
            <label class="form-field form-field--wide">
              <span class="form-field__label">标题</span>
              <input class="form-field__input" type="text" :value="detail.title" readonly />
            </label>
            <label class="form-field">
              <span class="form-field__label">类型</span>
              <input class="form-field__input" type="text" :value="`${detail.type}（示意动画 · 2:55）`" readonly />
            </label>
            <label class="form-field">
              <span class="form-field__label">适用范围</span>
              <input class="form-field__input" type="text" :value="detail.applicable_scope" readonly />
            </label>
            <label class="form-field form-field--wide">
              <span class="form-field__label">不适用范围</span>
              <input class="form-field__input" type="text" :value="detail.not_applicable || '—'" readonly />
            </label>
          </div>
          <div class="chips">
            <span v-for="t in (detail.applicable_scope || '').split(/[；;，,]/).filter(Boolean)" :key="t" class="chip">{{ t }}</span>
          </div>
        </AppCard>

        <AppCard class="panel">
          <div class="panel__head">
            <h2 class="panel__title">脚本（v{{ detail.current_version?.version ?? '—' }} 修订处高亮）</h2>
            <AppButton type="soft" size="sm">与 v{{ Math.max(1, (detail.current_version?.version ?? 2) - 1) }} 对比</AppButton>
          </div>
          <pre class="script">{{ scriptDiff.current || '（无脚本）' }}</pre>
          <div class="subtitle-row">
            <label class="form-field">
              <span class="form-field__label">字幕文件</span>
              <input class="form-field__input" type="text" value="subtitles_v2.srt · 已上传 · 与脚本一致性检查通过" readonly />
            </label>
            <label class="form-field">
              <span class="form-field__label">文字替代（全文）</span>
              <input class="form-field__input" type="text" :value="`已填写 · ${(detail.current_version?.subtitle_text ?? '').length} 字`" readonly />
            </label>
          </div>
        </AppCard>

        <AppCard class="panel">
          <h2 class="panel__title">依据与制作</h2>
          <p class="panel__hint">关联证据条目（≥1）</p>
          <ul class="evidence-list">
            <li class="evidence-item">
              <span class="evidence-item__id">G-03 指南摘录</span>
              <span class="evidence-item__desc">腰痛保守治疗一般原则 · 许可：可引用 · 核实 2026-08</span>
              <StatusTag status="confirmed" text="可用" />
            </li>
            <li class="evidence-item">
              <span class="evidence-item__id">E-11 审核科普</span>
              <span class="evidence-item__desc">久坐与腰痛 · 许可：可引用 · 核实 2026-08</span>
              <StatusTag status="confirmed" text="可用" />
            </li>
            <li class="evidence-item">
              <span class="evidence-item__id">G-07 指南</span>
              <span class="evidence-item__desc">许可待确认（不参与检索）</span>
              <StatusTag status="unconfirmed" text="待确认" />
            </li>
          </ul>
          <div class="subtitle-row">
            <label class="form-field">
              <span class="form-field__label">资源版本 / 制作方式</span>
              <input class="form-field__input" type="text" value="v2 · 受控 3D 白模渲染 · 未使用生成模型重绘 · 素材版本 M3D-0.4" readonly />
            </label>
            <label class="form-field">
              <span class="form-field__label">资源文件</span>
              <input class="form-field__input" type="text" value="activity_v2.mp4 · 480p/720p · 上传 2026-09-19" readonly />
            </label>
          </div>
        </AppCard>
      </div>

      <!-- 右：状态流转 / 审核记录 / 版本链 / 引用定位 -->
      <aside class="detail-aside">
        <AppCard class="panel">
          <h2 class="panel__title">状态流转</h2>
          <div class="flow">
            <span v-for="s in FLOW" :key="s" class="flow__step" :class="{ 'flow__step--current': detail.current_status === s }">
              {{ s }}
            </span>
          </div>
          <p class="flow__current">当前：{{ detail.current_status }}</p>

          <label class="form-field">
            <span class="form-field__label">审核意见（退回时必填；记录审核范围）</span>
            <textarea v-model="reviewComment" class="form-field__textarea" />
          </label>

          <div class="flow__actions">
            <AppButton v-if="canReview" type="primary" size="sm" :loading="submitting === 'approve'" @click="onApprove">✓ 审核通过</AppButton>
            <AppButton v-if="canReview" type="soft" size="sm" :loading="submitting === 'reject'" @click="onReject">× 退回修改</AppButton>
            <AppButton v-if="canPublish" type="primary" size="sm" :loading="submitting === 'publish'" @click="onPublish">发布（需双人确认）</AppButton>
          </div>
          <p v-if="!canReview" class="flow__note">当前角色无审核权限（需要「医学审核」）。</p>
        </AppCard>

        <AppCard class="panel">
          <h2 class="panel__title">审核记录</h2>
          <ul class="review-list">
            <li v-for="r in detail.review_records" :key="r.id" class="review-item">
              <span class="review-item__dot" aria-hidden="true" />
              <div class="review-item__body">
                <p class="review-item__title">{{ r.reviewer_name ?? '系统' }} {{ r.decision }}</p>
                <p class="review-item__meta">
                  {{ r.reviewed_at.slice(0, 10) }} {{ r.reviewed_at.slice(11, 16) }}
                  <template v-if="r.review_scope"> · 范围：{{ r.review_scope }}</template>
                  <template v-if="r.comment"> · {{ r.comment }}</template>
                </p>
              </div>
            </li>
            <li v-if="detail.review_records.length === 0" class="review-item">还没有审核记录</li>
          </ul>
        </AppCard>

        <AppCard class="panel">
          <h2 class="panel__title">版本链</h2>
          <ul class="version-list">
            <li v-for="v in detail.versions" :key="v.version" class="version-item">
              <span class="version-item__tag" :class="{ 'version-item__tag--current': v.is_current }">v{{ v.version }}</span>
              <span class="version-item__status">{{ detail.current_status }}</span>
              <span class="version-item__meta">{{ v.published_at ? v.published_at.slice(0, 10) : '未发布' }}</span>
            </li>
          </ul>
        </AppCard>

        <AppCard class="panel">
          <h2 class="panel__title">引用定位</h2>
          <p class="panel__hint">撤回了将统一下线，并可向受影响用户发送更正通知。</p>
          <AppButton v-if="canOffline" type="danger" size="sm" :loading="submitting === 'offline'" @click="onTakeOffline">
            一键下线并定位引用
          </AppButton>
        </AppCard>
      </aside>
    </div>
  </div>

  <AppCard v-else>
    <AppNotice v-if="errorText" type="warn">{{ errorText }}</AppNotice>
    <AppNotice v-else type="info">正在加载…</AppNotice>
  </AppCard>
</template>

<style scoped>
.detail-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

/* ---------- 面包屑 ---------- */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  flex-wrap: wrap;
}

.breadcrumb__link {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.breadcrumb__current {
  color: var(--color-text-1);
}

.breadcrumb__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* ---------- 网格 ---------- */
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: var(--spacing-xl);
  align-items: start;
}

.detail-main,
.detail-aside {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  min-width: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.panel__hint {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 表单 ---------- */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-md);
}

.form-field {
  display: block;
}

.form-field--wide {
  grid-column: 1 / -1;
}

.form-field__label {
  display: block;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  margin-bottom: var(--spacing-xs);
}

.form-field__input,
.form-field__textarea {
  width: 100%;
  min-height: 36px;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  color: var(--color-text-1);
  background: var(--color-surface);
}

.form-field__textarea {
  min-height: 64px;
  resize: vertical;
}

.subtitle-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-md);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.chip {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--color-neutral-light);
  color: var(--color-text-2);
  font-size: var(--font-size-aux-sm);
}

/* ---------- 脚本 ---------- */
.script {
  margin: 0;
  padding: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
  white-space: pre-wrap;
}

/* ---------- 证据 ---------- */
.evidence-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.evidence-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-aux-sm);
}

.evidence-item:first-child {
  border-top: none;
}

.evidence-item__id {
  min-width: 120px;
  font-weight: var(--font-weight-medium);
}

.evidence-item__desc {
  flex: 1;
  color: var(--color-text-2);
}

/* ---------- 状态流转 ---------- */
.flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
}

.flow__step {
  padding: 2px 10px;
  border-radius: var(--radius-tag);
  background: var(--color-neutral-light);
  color: var(--color-text-2);
  font-size: var(--font-size-aux-sm);
}

.flow__step--current {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
}

.flow__current {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.flow__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.flow__note {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

/* ---------- 审核记录 ---------- */
.review-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.review-item {
  display: flex;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
}

.review-item__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  margin-top: 7px;
  flex-shrink: 0;
}

.review-item__title {
  margin: 0;
  font-weight: var(--font-weight-medium);
}

.review-item__meta {
  margin: var(--spacing-xs) 0 0;
  color: var(--color-text-2);
}

/* ---------- 版本链 ---------- */
.version-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.version-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-aux-sm);
}

.version-item__tag {
  padding: 2px 8px;
  border-radius: var(--radius-tag);
  background: var(--color-neutral-light);
  color: var(--color-text-2);
}

.version-item__tag--current {
  background: var(--color-ok-light);
  color: var(--color-ok);
}

.version-item__status {
  color: var(--color-text-2);
}

.version-item__meta {
  margin-left: auto;
  color: var(--color-text-3);
}

@media (max-width: 1200px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
