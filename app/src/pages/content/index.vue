<script setup lang="ts">
/**
 * A13 审核内容库（设计稿 docs/design/app/A13.png，设计宽度 375）
 *
 * 内容都经过临床审定；适用范围、版本、审核记录、下线开关可见；推荐理由可见；
 * 用户端只能看到已发布且未下线的内容（服务端已过滤）。
 *
 * 数据全部来自 server 接口：
 * - GET /contents       已发布内容列表（含推荐理由）
 * - GET /contents/{id}  详情（A15）
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { listContents, type ContentListItem } from '../../api/contents'
import { getStatusBarHeight } from '../../utils/system'

/** 筛选标签（按设计稿） */
const FILTERS = ['全部', '报告术语', '节段位置', '医生会观察什么', '信息来源怎么行', '生活影响']

/** 推荐数量（设计稿：为你推荐 2 条） */
const RECOMMEND_COUNT = 2

const statusBarHeight = ref(0)
const filter = ref('全部')
const items = ref<ContentListItem[]>([])
const loading = ref(true)

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  await load()
})

async function load() {
  loading.value = true
  try {
    // 服务端按用户病程关键词计算推荐理由；用户端只能看到已发布且未下线内容
    items.value = await listContents()
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

/** 筛选（按适用标签匹配；「全部」不过滤） */
const filtered = computed<ContentListItem[]>(() => {
  if (filter.value === '全部') return items.value
  return items.value.filter((i) => i.applicable_scope.includes(filter.value))
})

/** 为你推荐（服务端推荐理由非默认的前 N 条） */
const recommends = computed<ContentListItem[]>(() =>
  items.value
    .filter((i) => i.recommend_reason && !i.recommend_reason.includes('通用'))
    .slice(0, RECOMMEND_COUNT),
)

/** 推荐原因说明（取第一条推荐理由） */
const recommendReason = computed<string>(() => recommends.value[0]?.recommend_reason ?? '')

function onFilterChange(label: string) {
  filter.value = label
}

function onOpenDetail(item: ContentListItem) {
  uni.navigateTo({ url: `/pages/content/detail?id=${encodeURIComponent(item.id)}` })
}

function onSearch() {
  uni.showToast({ title: '搜索功能将在后续版本提供', icon: 'none' })
}

function onBack() {
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/index/index' }),
  })
}
</script>

<template>
  <view class="page content-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <view class="nav__back" hover-class="nav__back--hover" :hover-stay-time="80" @click="onBack">
          <AppIcon name="back" :size="24" />
        </view>
        <text class="nav__title">审核内容库</text>
        <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80" @click="onSearch">
          <AppIcon name="search" :size="22" />
        </view>
      </view>
    </view>

    <view class="content-body">
      <!-- 筛选标签 -->
      <view class="filters">
        <view
          v-for="label in FILTERS"
          :key="label"
          class="filter-chip"
          :class="{ 'filter-chip--selected': filter === label }"
          hover-class="filter-chip--hover"
          :hover-stay-time="80"
          @click="onFilterChange(label)"
        >
          <text class="filter-chip__text">{{ label }}</text>
        </view>
      </view>

      <!-- 说明 -->
      <AppNotice type="info">
        这里的内容都经过临床审定，附字幕与文字替代。示意图不是你的真实病变，不能据此判断本人病因。
      </AppNotice>

      <!-- 为你推荐 -->
      <block v-if="recommends.length > 0">
        <view class="section-head">
          <text class="section-head__title">为你推荐</text>
          <text class="section-head__reason">（原因：{{ recommendReason }}）</text>
        </view>
        <view
          v-for="item in recommends"
          :key="item.id"
          class="content-card"
          hover-class="content-card--hover"
          :hover-stay-time="80"
          @click="onOpenDetail(item)"
        >
          <view class="content-card__icon" :class="{ 'content-card__icon--video': item.type === '视频' }">
            <AppIcon :name="item.type === '视频' ? 'play' : 'file'" :size="22" />
          </view>
          <view class="content-card__body">
            <text class="content-card__title">{{ item.title }}</text>
            <text class="content-card__meta">{{ item.type }} · 已审核 v{{ item.version ?? 1 }}</text>
            <view class="content-card__tags">
              <StatusTag status="reviewed" :text="`已审核 v${item.version ?? 1}`" />
              <StatusTag status="self" :text="`适用：${item.applicable_scope || '通用'}`" />
            </view>
          </view>
        </view>
      </block>

      <!-- 全部内容 -->
      <view class="section-head">
        <text class="section-head__title">全部内容</text>
        <text class="section-head__count">（{{ filtered.length }} / {{ items.length }}）</text>
      </view>

      <view
        v-for="item in filtered"
        :key="item.id"
        class="content-card"
        hover-class="content-card--hover"
        :hover-stay-time="80"
        @click="onOpenDetail(item)"
      >
        <view class="content-card__icon" :class="{ 'content-card__icon--video': item.type === '视频' }">
          <AppIcon :name="item.type === '视频' ? 'play' : 'file'" :size="22" />
        </view>
        <view class="content-card__body">
          <text class="content-card__title">{{ item.title }}</text>
          <text class="content-card__meta">{{ item.type }}</text>
          <view class="content-card__tags">
            <StatusTag status="reviewed" :text="`已审核 v${item.version ?? 1}`" />
            <StatusTag v-if="item.not_applicable" status="self" :text="item.not_applicable" />
            <StatusTag v-else status="self" :text="`适用：${item.applicable_scope || '通用'}`" />
          </view>
        </view>
      </view>

      <view v-if="filtered.length === 0 && !loading" class="empty">
        <text class="empty__text">该分类下暂无已发布内容。</text>
      </view>

      <!-- 边界说明 -->
      <AppNotice type="warn">
        本库不包含实时生成的个性化查体或训练处方；康复动作内容待专业设计与审定后再加入。
      </AppNotice>
    </view>

    <TabBar />
  </view>
</template>

<style lang="scss">
.content-page {
  min-height: 100vh;
  background-color: $color-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 120rpx);
}

.content-body {
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 筛选 ---------- */
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
}

.filter-chip {
  min-height: 56rpx;
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

.filter-chip__text {
  font-size: $font-size-body;
  color: $color-text-1;

  .filter-chip--selected & {
    color: $color-surface;
    font-weight: $font-weight-medium;
  }
}

/* ---------- 段标题 ---------- */
.section-head {
  display: flex;
  align-items: baseline;
}

.section-head__title {
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.section-head__reason {
  flex: 1;
  font-size: $font-size-aux;
  color: $color-text-2;
  margin-left: $spacing-xs;
}

.section-head__count {
  font-size: $font-size-aux;
  color: $color-text-3;
}

/* ---------- 内容卡 ---------- */
.content-card {
  display: flex;
  align-items: center;
  padding: $spacing-lg;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;

  &--hover {
    border-color: $color-primary;
  }
}

.content-card__icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: $radius-button;
  background-color: $color-primary-light;
  color: $color-primary;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.content-card__body {
  flex: 1;
  margin-left: $spacing-md;
  min-width: 0;
}

.content-card__title {
  display: block;
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: $line-height-body;
}

.content-card__meta {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
}

.content-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-xs;
  margin-top: $spacing-xs;
}

/* ---------- 空状态 ---------- */
.empty {
  padding: $spacing-lg;
}

.empty__text {
  font-size: $font-size-body;
  color: $color-text-3;
}
</style>
