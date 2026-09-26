<script setup lang="ts">
/**
 * W07 审核内容库（设计稿 docs/design/web/W07.png，设计宽度 1440）
 *
 * 卡片网格（推荐理由可见、下线项置灰）；右侧详情抽屉含适用范围、
 * 文字替代、复述任务；用户端只能看到已发布且未下线的内容。
 *
 * 数据全部来自 server 接口：
 * - GET  /contents       已发布内容列表（含推荐理由）
 * - GET  /contents/{id}  内容详情（版本链、审核记录、字幕与文字替代）
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppNotice from '@/components/AppNotice.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useAuthStore } from '@/stores/auth'
import { getContentDetail, listContents, type ContentDetail, type ContentListItem, type ReviewRecordView } from '@/api/contents'
import { beijingDate } from '@/utils/date'

/** 筛选标签（按设计稿） */
const FILTERS = ['全部', '报告术语', '节段位置', '医生会观察什么', '信息来源怎么看', '生活影响']

const auth = useAuthStore()
const router = useRouter()

const loading = ref(true)
const items = ref<ContentListItem[]>([])
const filter = ref('全部')
const keyword = ref('')

/** 详情抽屉 */
const drawerOpen = ref(false)
const detail = ref<ContentDetail | null>(null)
const detailLoading = ref(false)
const subtitleExpanded = ref(false)
const retelling = ref('')
const retellDone = ref(false)
const helpDone = ref('')

onMounted(async () => {
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  await load()
})

async function load() {
  loading.value = true
  try {
    items.value = await listContents()
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  alert(title)
}

/* ---------- 派生数据 ---------- */

const filtered = computed<ContentListItem[]>(() => {
  let list = items.value
  if (filter.value !== '全部') {
    list = list.filter((i) => i.applicable_scope.includes(filter.value))
  }
  const kw = keyword.value.trim()
  if (kw) list = list.filter((i) => i.title.includes(kw))
  return list
})

const recommends = computed<ContentListItem[]>(() =>
  items.value.filter((i) => i.recommend_reason && !i.recommend_reason.includes('通用')).slice(0, 3),
)

const recommendReason = computed<string>(() => recommends.value[0]?.recommend_reason ?? '')

/* ---------- 详情抽屉 ---------- */

async function onOpenDetail(item: ContentListItem) {
  drawerOpen.value = true
  detailLoading.value = true
  subtitleExpanded.value = false
  retelling.value = ''
  retellDone.value = false
  helpDone.value = ''
  try {
    detail.value = await getContentDetail(item.id)
  } catch (e) {
    toast(e instanceof Error ? e.message : '内容加载失败')
    drawerOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

function onCloseDrawer() {
  drawerOpen.value = false
}

const detailVersion = computed<number>(() => detail.value?.current_version?.version ?? 1)
const detailReviewed = computed<string>(() => {
  const records = detail.value?.review_records ?? []
  const passed = records.find((r: ReviewRecordView) => r.decision === '通过')
  const at = passed?.reviewed_at ?? detail.value?.current_version?.published_at
  return at ? beijingDate(at) : ''
})
const detailApplicable = computed<string[]>(() =>
  (detail.value?.applicable_scope ?? '').split(/[；;，,]/).filter((s: string) => s.trim()),
)
const detailNotApplicable = computed<string[]>(() =>
  (detail.value?.not_applicable ?? '').split(/[；;，,]/).filter((s: string) => s.trim() && s !== '—'),
)

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
</script>

<template>
  <div class="contents-page" v-if="auth.isLoggedIn">
    <header class="contents-page__head">
      <div>
        <h1 class="contents-page__title">审核内容库</h1>
        <p class="contents-page__desc">
          所有内容经临床审定，附字幕与文字替代。示意图不是你的真实病变，不能据此判断本人病因。
        </p>
      </div>
      <div class="contents-page__search">
        <span aria-hidden="true">🔍</span>
        <input v-model="keyword" type="search" placeholder="搜索已发布内容" />
      </div>
    </header>

    <div v-if="loading" class="contents-page__loading">正在加载…</div>

    <template v-else>
      <div class="filters">
        <button
          v-for="f in FILTERS"
          :key="f"
          type="button"
          class="filter-chip"
          :class="{ 'filter-chip--selected': filter === f }"
          @click="filter = f"
        >
          {{ f }}
        </button>
      </div>

      <!-- 为你推荐 -->
      <section v-if="recommends.length > 0" class="recommend">
        <h2 class="recommend__label">为你推荐（原因：{{ recommendReason }}）</h2>
        <div class="content-grid content-grid--three">
          <AppCard v-for="item in recommends" :key="item.id" class="content-card" padded>
            <button type="button" class="content-card__btn" @click="onOpenDetail(item)">
              <span class="content-card__thumb content-card__thumb--video" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 6.4 18.6 12l-9.4 5.6z" /></svg>
              </span>
              <span class="content-card__title">{{ item.title }}</span>
              <span class="content-card__meta">{{ item.type }} · 已审核 v{{ item.version ?? 1 }}</span>
              <span class="content-card__tags">
                <StatusTag status="reviewed" :text="`已审核 v${item.version ?? 1}`" />
                <StatusTag status="self" :text="`适用：${item.applicable_scope || '通用'}`" />
              </span>
            </button>
          </AppCard>
        </div>
      </section>

      <!-- 全部内容 -->
      <section class="all">
        <h2 class="all__label">全部内容（{{ filtered.length }} / {{ items.length }}）</h2>
        <div class="content-grid content-grid--three">
          <AppCard v-for="item in filtered" :key="item.id" class="content-card" padded>
            <button type="button" class="content-card__btn" @click="onOpenDetail(item)">
              <span
                class="content-card__thumb"
                :class="item.type === '视频' ? 'content-card__thumb--video' : 'content-card__thumb--article'"
                aria-hidden="true"
              >
                <svg v-if="item.type === '视频'" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 6.4 18.6 12l-9.4 5.6z" /></svg>
                <svg v-else viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12.5h7M12 9v7" /></svg>
              </span>
              <span class="content-card__title">{{ item.title }}</span>
              <span class="content-card__meta">{{ item.type }}</span>
              <span class="content-card__tags">
                <StatusTag status="reviewed" :text="`已审核 v${item.version ?? 1}`" />
                <StatusTag v-if="item.not_applicable && item.not_applicable !== '—'" status="self" :text="item.not_applicable" />
                <StatusTag v-else status="self" :text="`适用：${item.applicable_scope || '通用'}`" />
              </span>
            </button>
          </AppCard>
        </div>
        <p v-if="filtered.length === 0" class="all__empty">没有匹配的已发布内容。</p>
      </section>

      <AppNotice type="warn">
        本库不包含实时生成的个性化查体或训练处方；康复动作内容待专业设计与审定后再加入。
      </AppNotice>
    </template>

    <!-- 详情抽屉 -->
    <div v-if="drawerOpen" class="drawer-mask" @click.self="onCloseDrawer">
      <aside class="drawer">
        <div class="drawer__head">
          <h2 class="drawer__title">内容详情</h2>
          <button type="button" class="drawer__close" aria-label="关闭" @click="onCloseDrawer">×</button>
        </div>
        <div v-if="detailLoading" class="drawer__loading">正在加载…</div>
        <template v-else-if="detail">
          <div class="drawer__player">
            <span class="drawer__play" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 6.4 18.6 12l-9.4 5.6z" /></svg>
            </span>
            <span class="drawer__player-caption">示意动画（非本人人像） · CC 字幕</span>
          </div>

          <h3 class="drawer__content-title">{{ detail.title }}</h3>
          <div class="drawer__tags">
            <StatusTag status="reviewed" :text="`已审核 v${detailVersion}`" />
            <StatusTag status="self" :text="`临床审定 · ${detailReviewed}`" />
            <StatusTag status="self" text="字幕 · 文字替代" />
          </div>

          <div class="drawer__section">
            <p class="drawer__row"><span class="drawer__row-label">适用</span><span>{{ detailApplicable.join('、') || '尚未确认' }}</span></p>
            <p class="drawer__row"><span class="drawer__row-label">不适用</span><span>{{ detailNotApplicable.join('、') || '报告未提及' }}</span></p>
          </div>

          <div class="drawer__section">
            <button type="button" class="drawer__collapse" @click="subtitleExpanded = !subtitleExpanded">
              文字替代（全文）<span aria-hidden="true">{{ subtitleExpanded ? '▲' : '▼' }}</span>
            </button>
            <p v-if="subtitleExpanded" class="drawer__subtitle">
              {{ detail.current_version?.subtitle_text || '尚未提供文字替代' }}
            </p>
          </div>

          <div class="drawer__section drawer__retell">
            <p class="drawer__retell-title">看完后，用一句话说说你理解了什么（可选）</p>
            <p class="drawer__retell-note">这用来检查视频有没有造成新的误解，不是考试，也不会影响你的分析结果。</p>
            <textarea v-model="retelling" class="drawer__retell-input" placeholder="例如：L5/S1 是腰椎最下面那个椎间盘的位置…" />
            <AppButton v-if="!retellDone" type="primary" @click="onRetell">提交</AppButton>
            <p v-else class="drawer__retell-done">已收到你的复述，谢谢。</p>
          </div>

          <div class="drawer__section">
            <p class="drawer__help-title">这条内容对你有帮助吗？</p>
            <div class="drawer__help">
              <button
                v-for="h in ['看懂了', '没看懂', '内容有误（举报）']"
                :key="h"
                type="button"
                class="help-chip"
                :class="{ 'help-chip--selected': helpDone === h }"
                @click="onHelp(h)"
              >
                {{ h }}
              </button>
            </div>
          </div>
        </template>
      </aside>
    </div>
  </div>

  <AppCard v-else>
    <p>登录后可以浏览审核内容库。</p>
    <AppButton type="primary" @click="router.push('/login')">登录 / 注册</AppButton>
  </AppCard>
</template>

<style scoped>
.contents-page {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.contents-page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--spacing-lg);
}

.contents-page__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.contents-page__desc {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.contents-page__search {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 40px;
  padding: 0 var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
}

.contents-page__search input {
  border: none;
  outline: none;
  font-family: inherit;
  font-size: var(--font-size-aux);
  width: 220px;
}

.contents-page__loading {
  padding: var(--spacing-xxl);
  text-align: center;
  color: var(--color-text-2);
}

/* ---------- 筛选 ---------- */
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.filter-chip {
  min-height: 32px;
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  color: var(--color-text-1);
  cursor: pointer;
}

.filter-chip--selected {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-surface);
}

/* ---------- 卡片网格 ---------- */
.recommend__label,
.all__label {
  margin: 0 0 var(--spacing-md);
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.recommend__label {
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
  font-weight: var(--font-weight-regular);
}

.content-grid {
  display: grid;
  gap: var(--spacing-md);
}

.content-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.content-card {
  padding: 0;
}

.content-card__btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg);
  background: none;
  border: none;
  border-radius: var(--radius-card);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.content-card__btn:hover {
  background: var(--color-bg);
}

.content-card__thumb {
  width: 100%;
  height: 96px;
  border-radius: var(--radius-button);
  background: var(--color-primary-light);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.content-card__thumb--article {
  background: var(--color-info-light);
  color: var(--color-info);
}

.content-card__title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-1);
  line-height: var(--line-height-body);
}

.content-card__meta {
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.content-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.all__empty {
  margin: var(--spacing-md) 0 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-3);
}

/* ---------- 详情抽屉 ---------- */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(27, 34, 48, 0.4);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}

.drawer {
  width: 460px;
  max-width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--color-surface);
  padding: var(--spacing-xl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer__title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.drawer__close {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  font-size: 20px;
  color: var(--color-text-2);
  cursor: pointer;
}

.drawer__loading {
  padding: var(--spacing-xl);
  text-align: center;
  color: var(--color-text-2);
}

.drawer__player {
  height: 200px;
  background: #1b2230;
  border-radius: var(--radius-button);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
}

.drawer__play {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.drawer__player-caption {
  font-size: var(--font-size-aux-sm);
  color: rgba(255, 255, 255, 0.75);
}

.drawer__content-title {
  margin: 0;
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.drawer__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.drawer__section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--color-border);
}

.drawer__row {
  margin: 0;
  display: flex;
  gap: var(--spacing-md);
  font-size: var(--font-size-aux);
  line-height: var(--line-height-body);
}

.drawer__row-label {
  width: 64px;
  flex-shrink: 0;
  color: var(--color-text-2);
}

.drawer__collapse {
  background: none;
  border: none;
  padding: 0;
  font-size: var(--font-size-aux);
  font-family: inherit;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-1);
  cursor: pointer;
  text-align: left;
}

.drawer__subtitle {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.drawer__retell {
  background: var(--color-primary-light);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-button);
  padding: var(--spacing-md);
}

.drawer__retell-title {
  margin: 0;
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
}

.drawer__retell-note {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
}

.drawer__retell-input {
  width: 100%;
  min-height: 72px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  font-family: inherit;
  font-size: var(--font-size-aux);
  resize: vertical;
}

.drawer__retell-done {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-primary);
}

.drawer__help-title {
  margin: 0;
  font-size: var(--font-size-aux);
  font-weight: var(--font-weight-medium);
}

.drawer__help {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.help-chip {
  min-height: 32px;
  padding: var(--spacing-xs) var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-aux-sm);
  font-family: inherit;
  cursor: pointer;
}

.help-chip--selected {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

@media (max-width: 1100px) {
  .content-grid--three {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
