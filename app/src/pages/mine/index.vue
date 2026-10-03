<script setup lang="ts">
/**
 * A17 我的 · 数据与授权（设计稿 docs/design/app/A17.png，设计宽度 375，主 Tab）
 *
 * 同意记录可查可撤回；导出与删除；身份与分析分离；服务边界可见。
 *
 * 数据全部来自 server 接口：
 * - GET  /auth/me                      当前用户（脱敏手机号）
 * - GET  /auth/consents                同意记录
 * - POST /auth/consents/:scope/revoke  撤回同意（立即生效）
 * - GET  /safety/emergency-notice      紧急就医提示（公开）
 */
import { computed, onMounted, ref } from 'vue';
import AppButton from '../../components/AppButton.vue'
import AppCard from '../../components/AppCard.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import StatusTag from '../../components/StatusTag.vue'
import TabBar from '../../components/TabBar.vue'
import { useAuthStore } from '../../stores/auth'
import {
  cancelDelete,
  grantConsent,
  logout,
  confirmDelete,
  exportMyData,
  listConsents,
  me,
  requestDelete,
  revokeConsent,
  type ConsentItem,
  type DeletionStatus,
} from '../../api/auth'
import { beijingDateTime, getStatusBarHeight } from '../../utils/system'

/** 版本信息（按设计稿） */
const VERSION_INFO = 'App v0.1.0 · 规则集版本见「一页分析」的来源信息 · 内容库版本见分析页'

const auth = useAuthStore()
const statusBarHeight = ref(0)
const phoneMasked = ref('')
const consents = ref<ConsentItem[]>([])
const loading = ref(true)

onMounted(async () => {
  statusBarHeight.value = getStatusBarHeight()
  if (!auth.isLoggedIn) {
    loading.value = false
    return
  }
  await load()
})

async function load() {
  loading.value = true
  try {
    const profile = await me()
    phoneMasked.value = profile.phone_masked
    consents.value = await listConsents()
    // 待执行的删除申请：刷新 / 重启后仍要能看到生效时间（可取消）
    const pending = profile.deletion ?? null
    if (pending && (pending.status === '冷静期中' || pending.status === '已申请')) {
      deletion.value = pending
      deleteStep.value = 'ready'
    } else if (pending && pending.status !== '冷静期中') {
      deletion.value = null
      deleteStep.value = 'idle'
    }
  } catch {
    // 保留已缓存的登录态信息
  } finally {
    loading.value = false
  }
}

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

/* ---------- 派生数据 ---------- */

/** 健康信息处理同意状态 */
const healthConsent = computed<ConsentItem | undefined>(() =>
  consents.value.find((c) => c.scope === '健康信息处理'),
)

/** 是否已同意健康信息处理（撤回后显示「重新同意」入口） */
const healthGranted = computed<boolean>(() => healthConsent.value?.granted === true)

const consentSummary = computed<string>(() => {
  const parts: string[] = []
  const health = healthConsent.value
  parts.push(
    health?.granted
      ? `健康信息处理：已同意 ${health.granted_at.slice(0, 10)}`
      : '健康信息处理：未同意',
  )
  const others = consents.value.filter((c) => c.scope !== '健康信息处理')
  const granted = others.filter((c) => c.granted).map((c) => c.scope)
  parts.push(granted.length > 0 ? `${granted.join('/')}：已开启` : '分享/产品改进：未开启')
  return parts.join(' · ')
})

/** 匿名标识（脱敏展示；真实标识不与分析内容关联存储） */
const anonymousId = computed<string>(() => {
  const id = auth.userId ?? ''
  if (!id) return ''
  return `U-${id.slice(0, 4).toUpperCase()}…`
})

/* ---------- 操作 ---------- */

async function onRevokeHealth() {
  uni.showModal({
    title: '撤回「处理健康信息」的同意',
    content: '撤回后将停止个性化分析；已审核科普与已导出的摘要仍可使用。确定撤回吗？',
    confirmText: '撤回',
    confirmColor: '#D93B3B',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await revokeConsent('健康信息处理')
        await load()
        toast('已撤回同意，个性化分析已停止')
      } catch (e) {
        toast(e instanceof Error ? e.message : '撤回失败，请稍后重试')
      }
    },
  })
}

/** 重新同意（撤回后可在此再次开启，不必退出登录） */
async function onGrantHealth() {
  uni.showModal({
    title: '重新同意处理健康信息',
    content: '同意后恢复个性化分析与问答；你可以随时再撤回。',
    confirmText: '同意',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await grantConsent('健康信息处理')
        await load()
        toast('已重新同意，个性化分析已恢复')
      } catch (e) {
        toast(e instanceof Error ? e.message : '同意失败，请稍后重试')
      }
    },
  })
}

/**
 * 删除账户：手机号 + 短信验证码二次确认 → 24 小时冷静期 → 确认后硬删。
 * 用页面内弹层而不是嵌套 showModal（H5 上第二个弹窗不会弹出，验收反馈第 5 条）；
 * 手机号与验证码都由用户自己输入，不预填。
 */
const deleteStep = ref<'idle' | 'requested' | 'ready'>('idle')
const deletePhone = ref('')
const deleteCode = ref('')
const deletion = ref<DeletionStatus | null>(null)
const deleteDialog = ref<'none' | 'request' | 'confirm'>('none')
const deletePhoneInput = ref('')
const deleteCodeInput = ref('')
const deleteBusy = ref(false)

function onExportData() {
  uni.showModal({
    title: '导出我的全部数据',
    content: '导出为 JSON 文件（包含病程、报告原文、分析版本、问答与同意记录），保存在本地，不上传服务器。',
    confirmText: '导出',
    success: async (res) => {
      if (!res.confirm) return
      try {
        const data = await exportMyData()
        const text = JSON.stringify(data, null, 2)
        // #ifdef H5
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'yaoyouju-export-' + new Date().toISOString().slice(0, 10) + '.json'
        link.click()
        URL.revokeObjectURL(url)
        // #endif
        toast('已生成导出文件（JSON）')
      } catch (e) {
        toast(e instanceof Error ? e.message : '导出失败，请稍后重试')
      }
    },
  })
}

function onDeleteAccount() {
  if (deleteStep.value === 'idle') {
    uni.showModal({
      title: '删除账户与数据',
           content: '需要手机号与短信验证码二次确认，之后进入 24 小时冷静期（可取消）。删除会覆盖病程、报告、分析、问答与反馈。',
      confirmText: '继续',
      confirmColor: '#D93B3B',
      success: () => {
        deletePhoneInput.value = ''
        deleteCodeInput.value = ''
        deleteDialog.value = 'request'
      },
    })
    return
  }
  if (deleteStep.value === 'requested') {
    deletePhoneInput.value = ''
    deleteCodeInput.value = ''
    deleteDialog.value = 'request'
    return
  }
  deleteDialog.value = 'confirm'
}

/** 提交删除申请（手机号 + 验证码都要用户自己输入，不预填） */
async function submitDeleteRequest() {
  const phone = deletePhoneInput.value.trim()
  const code = deleteCodeInput.value.trim()
  if (!/^1\d{10}$/.test(phone)) {
    toast('请输入正确的 11 位手机号')
    return
  }
  if (!/^\d{6}$/.test(code)) {
    toast('请输入 6 位验证码')
    return
  }
  deleteBusy.value = true
  try {
    deletion.value = await requestDelete(phone, code)
    deletePhone.value = phone
    deleteCode.value = code
    deleteStep.value = 'ready'
    deleteDialog.value = 'none'
    toast('删除申请已提交，' + beijingDateTime(deletion.value.effective_at) + '（北京时间）之后才能确认删除')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : '提交删除申请失败')
  } finally {
    deleteBusy.value = false
  }
}

/** 冷静期结束后确认删除（再次输入手机号与验证码） */
async function submitDeleteConfirm() {
  const phone = deletePhoneInput.value.trim() || deletePhone.value
  const code = deleteCodeInput.value.trim()
  if (!/^1\d{10}$/.test(phone)) {
    toast('请输入正确的 11 位手机号')
    return
  }
  if (!/^\d{6}$/.test(code)) {
    toast('请输入 6 位验证码')
    return
  }
  deleteBusy.value = true
  try {
    await confirmDelete(phone, code)
    toast('账户与数据已删除')
    auth.logout()
    uni.reLaunch({ url: '/pages/login/login' })
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败，请确认冷静期是否结束')
  } finally {
    deleteBusy.value = false
  }
}
async function doCancelDelete() {
  try {
    await cancelDelete()
    deleteStep.value = 'idle'
    deletion.value = null
    toast('已取消删除申请')
  } catch (e) {
    toast(e instanceof Error ? e.message : '取消失败')
  }
}

function onCaseSubmission() {
  uni.showToast({ title: '案例投稿为二期预留，尚未开放', icon: 'none' })
}

function onServiceScope() {
  uni.showToast({ title: '不作诊断、不给手术判断、不调整药物、不生成严重程度总评', icon: 'none' })
}

function onEmergency() {
  uni.navigateTo({ url: '/pages/emergency/notice' })
}

function onReviewPolicy() {
  uni.showToast({ title: '谁审核了内容、依据是什么、如何举报错误', icon: 'none' })
}

function onVersionInfo() {
  uni.showToast({ title: VERSION_INFO, icon: 'none' })
}

function onConsentRecords() {
  uni.showToast({ title: consentSummary.value, icon: 'none' })
}

async function onLogout() {
  try {
    await logout()
  } catch {
    // 网络异常也允许本地退出（服务端令牌到期自然失效）
  }
  auth.logout()
  uni.reLaunch({ url: '/pages/login/login' })
}

function onSettings() {
  uni.showToast({ title: '设置功能将在后续版本提供', icon: 'none' })
}
</script>

<template>
  <view class="page mine-page">
    <!-- 自定义导航栏 -->
    <view class="nav" :style="{ paddingTop: `${statusBarHeight}px` }">
      <view class="nav__bar">
        <text class="nav__title">我的</text>
        <view class="nav__action" hover-class="nav__action--hover" :hover-stay-time="80" @click="onSettings">
          <AppIcon name="gear" :size="22" />
        </view>
      </view>
    </view>

    <view class="mine-body">
      <!-- 用户卡片 -->
      <AppCard>
        <view class="user">
          <view class="user__avatar">
            <text class="user__avatar-text">U</text>
          </view>
          <view class="user__info">
            <text class="user__phone">{{ phoneMasked || auth.phoneMasked || '未登录' }}</text>
            <text class="user__anon">
              匿名内部标识 {{ anonymousId || '尚未确认' }}…（分析内容与身份信息分离存储）
            </text>
          </view>
        </view>
      </AppCard>

      <!-- 数据与授权 -->
      <AppCard>
        <text class="card-group-title">数据与授权</text>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onConsentRecords">
          <view class="row__icon row__icon--shield">
            <AppIcon name="shield" :size="20" />
          </view>
          <view class="row__body">
            <view class="row__title-line">
              <text class="row__title">我的同意记录</text>
              <StatusTag status="confirmed" text="可撤回" />
            </view>
            <text class="row__desc">{{ consentSummary || '正在加载…' }}</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view v-if="healthGranted" class="row" hover-class="row--hover" :hover-stay-time="80" @click="onRevokeHealth">
          <view class="row__icon row__icon--close">
            <AppIcon name="close" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">撤回“处理健康信息”的同意</text>
            <text class="row__desc">撤回后停止个性化分析，已审核科普与已导出摘要仍可用</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view v-else class="row" hover-class="row--hover" :hover-stay-time="80" @click="onGrantHealth">
          <view class="row__icon row__icon--shield">
            <AppIcon name="shield" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">重新同意“处理健康信息”</text>
            <text class="row__desc">同意后才能继续个性化分析与问答；已录入的数据仍可只读查看</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onExportData">
          <view class="row__icon row__icon--download">
            <AppIcon name="download" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">导出我的全部数据</text>
            <text class="row__desc">可读格式（PDF / JSON），包含病程、报告原文与分析版本</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view v-if="deleteStep !== 'idle'" class="row" hover-class="row--hover" :hover-stay-time="80" @click="doCancelDelete">
          <view class="row__body">
            <text class="row__title">取消删除申请</text>
            <text class="row__desc">冷静期内可以撤销，删除不会执行</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

      <!-- 删除账户弹层：手机号 + 短信验证码二次确认（不预填任何内容） -->
      <view v-if="deleteDialog !== 'none'" class="mask" @click="deleteDialog = 'none'">
        <view class="dialog" @click.stop>
          <text class="dialog__title">{{ deleteDialog === 'request' ? '申请删除账户' : '确认删除（不可恢复）' }}</text>
          <text v-if="deleteDialog === 'request'" class="dialog__desc">
            请输入本账号绑定的手机号与短信验证码。演示环境验证码固定 123456。
          </text>
          <text v-else class="dialog__desc">
            冷静期{{ deletion?.can_confirm ? '已结束' : '至 ' + beijingDateTime(deletion?.effective_at ?? '') + '（北京时间）' }}。
            {{ deletion?.can_confirm ? '确认后不可恢复，将清除全部个人数据。' : '现在还不能确认删除；可以先取消删除。' }}
          </text>
          <view class="dialog__field">
            <text class="dialog__label">手机号</text>
            <input v-model="deletePhoneInput" class="dialog__input" type="number" maxlength="11" placeholder="请输入 11 位手机号" />
          </view>
          <view class="dialog__field">
            <text class="dialog__label">短信验证码</text>
            <input v-model="deleteCodeInput" class="dialog__input" type="number" maxlength="6" placeholder="请输入 6 位验证码" />
          </view>
          <view class="dialog__actions">
            <AppButton
              v-if="deleteDialog === 'request'"
              type="primary"
              block
              :loading="deleteBusy"
              @click="submitDeleteRequest"
            >
              提交删除申请
            </AppButton>
            <AppButton
              v-else
              type="danger"
              block
              :loading="deleteBusy"
              :disabled="!deletion?.can_confirm"
              @click="submitDeleteConfirm"
            >
              确认删除（不可恢复）
            </AppButton>
            <AppButton type="soft" block @click="deleteDialog = 'none'">取消</AppButton>
          </view>
        </view>
      </view>
        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onDeleteAccount">
          <view class="row__icon row__icon--delete">
            <AppIcon name="trash" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title row__title--danger">删除账户与数据</text>
            <text class="row__desc">覆盖公开卡片、搜索索引、向量、缓存与派生摘要</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>
      </AppCard>

      <!-- 分享与社区 -->
      <AppCard>
        <text class="card-group-title">分享与社区</text>
        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onCaseSubmission">
          <view class="row__icon row__icon--community">
            <AppIcon name="user" :size="20" />
          </view>
          <view class="row__body">
            <view class="row__title-line">
              <text class="row__title">案例投稿（二期）</text>
              <StatusTag status="offline" text="尚未开放" />
            </view>
            <text class="row__desc">单独授权 · 预览 · 去除第三方信息 · 人工审核 · 可撤回</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>
      </AppCard>

      <!-- 服务信息 -->
      <AppCard>
        <text class="card-group-title">服务信息</text>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onServiceScope">
          <view class="row__icon row__icon--info">
            <AppIcon name="info" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">服务范围与不做的事</text>
            <text class="row__desc">不作诊断、不给手术判断、不调整药物、不生成严重程度总评</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onEmergency">
          <view class="row__icon row__icon--alert">
            <AppIcon name="alert" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title row__title--danger">紧急就医提示</text>
            <text class="row__desc">无需登录，网络异常时也可查看</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onReviewPolicy">
          <view class="row__icon row__icon--file">
            <AppIcon name="file" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">临床审定与来源说明</text>
            <text class="row__desc">谁审核了内容、依据是什么、如何举报错误</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>

        <view class="row" hover-class="row--hover" :hover-stay-time="80" @click="onVersionInfo">
          <view class="row__icon row__icon--gear">
            <AppIcon name="gear" :size="20" />
          </view>
          <view class="row__body">
            <text class="row__title">版本信息</text>
            <text class="row__desc">{{ VERSION_INFO }}</text>
          </view>
          <AppIcon name="arrow-right" :size="16" />
        </view>
      </AppCard>

      <!-- 退出登录 -->
      <view class="logout" hover-class="logout--hover" :hover-stay-time="80" @click="onLogout">
        <AppIcon name="logout" :size="18" />
        <text class="logout__text">退出登录</text>
      </view>

      <!-- 删除说明 -->
      <AppNotice type="warn">
        删除会覆盖公开卡片、搜索索引、向量、缓存和派生摘要；备份与依法需要保留的信息按政策管理，不承诺瞬时全网删除。
      </AppNotice>
    </view>

    <TabBar />
  </view>
</template>

<style lang="scss">
.mine-page {
  min-height: 100vh;
  background-color: $color-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 120rpx);
}

.mine-body {
  padding: $spacing-lg $spacing-page 0;
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

/* ---------- 用户卡片 ---------- */
.user {
  display: flex;
  align-items: center;
}

.user__avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background-color: $color-primary-light;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user__avatar-text {
  font-size: $font-size-page-title;
  font-weight: $font-weight-medium;
  color: $color-primary;
}

.user__info {
  flex: 1;
  margin-left: $spacing-md;
  min-width: 0;
}

.user__phone {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.user__anon {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 分组标题 ---------- */
.card-group-title {
  display: block;
  font-size: $font-size-aux;
  color: $color-text-3;
  margin-bottom: $spacing-sm;
}

/* ---------- 行 ---------- */
.row {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-md 0;
  border-top: 2rpx solid $color-border;

  &:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  &--hover {
    opacity: 0.85;
  }
}

.row__icon {
  width: 56rpx;
  height: 56rpx;
  border-radius: $radius-button;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &--shield {
    background-color: $color-info-light;
    color: $color-info;
  }

  &--close {
    background-color: $color-warn-light;
    color: $color-warn;
  }

  &--download {
    background-color: $color-primary-light;
    color: $color-primary;
  }

  &--delete {
    background-color: $color-error-light;
    color: $color-error;
  }

  &--community {
    background-color: $color-neutral-light;
    color: $color-text-2;
  }

  &--info {
    background-color: $color-info-light;
    color: $color-info;
  }

  &--alert {
    background-color: $color-error-light;
    color: $color-error;
  }

  &--file {
    background-color: $color-primary-light;
    color: $color-primary;
  }

  &--gear {
    background-color: $color-neutral-light;
    color: $color-text-2;
  }
}

.row__body {
  flex: 1;
  min-width: 0;
}

.row__title-line {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.row__title {
  font-size: $font-size-body;
  font-weight: $font-weight-medium;
  color: $color-text-1;

  &--danger {
    color: $color-error;
  }
}

.row__desc {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 退出登录 ---------- */
.logout {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-xs;
  background-color: $color-surface;
  border: 2rpx solid $color-border;
  border-radius: $radius-card;
  color: $color-primary;

  &--hover {
    opacity: 0.8;
  }
}

.logout__text {
  font-size: $font-size-body;
  color: $color-primary;
}

/* ---------- 删除账户弹层 ---------- */
.mask {
  position: fixed;
  inset: 0;
  background-color: rgba(27, 34, 48, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: $spacing-page;
  z-index: 1000;
}

.dialog {
  width: 100%;
  max-width: 640rpx;
  background-color: $color-surface;
  border-radius: $radius-card;
  padding: $spacing-lg;
}

.dialog__title {
  display: block;
  font-size: $font-size-card-title;
  font-weight: $font-weight-medium;
  color: $color-text-1;
}

.dialog__desc {
  display: block;
  margin-top: $spacing-xs;
  font-size: $font-size-aux;
  color: $color-text-2;
  line-height: $line-height-body;
}

.dialog__field {
  margin-top: $spacing-md;
}

.dialog__label {
  display: block;
  font-size: $font-size-aux;
  color: $color-text-2;
  margin-bottom: $spacing-xs;
}

.dialog__input {
  width: 100%;
  height: 88rpx;
  padding: 0 $spacing-md;
  border: 2rpx solid $color-border;
  border-radius: $radius-button;
  font-size: $font-size-body;
  color: $color-text-1;
  background-color: $color-surface;
}

.dialog__actions {
  margin-top: $spacing-lg;
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}
</style>
