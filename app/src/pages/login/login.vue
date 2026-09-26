<script setup lang="ts">
/**
 * A01 启动 · 登录与授权（设计稿 docs/design/app/A01.png，宽度 375）
 *
 * 布局：品牌区（腰字方块 + 品牌名 + 副标题）→ 三个价值芯片 → 手机号 / 验证码 →
 *       主按钮「登录 / 注册」→ 两条协议勾选 → 信息提示条 → 就医提示条。
 * 产品红线：
 * - 「单独同意：处理我的健康信息」独立勾选、默认不勾选，登录时一并提交，可随时在
 *   「我的 - 数据与授权」撤回（见 stores/auth.ts 与 api/auth.ts）。
 * - 就医提示入口不被登录阻断：未登录也可直接进入 pages/emergency/notice。
 * - 已登录用户进入应用直接进首页（tab 页）。
 * 数据全部来自 server 接口（/auth/sms-code、/auth/login、/auth/consents），
 * 验证码在演示环境中固定为 123456（见 docs/brief.md 演示实现的简化）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppButton from '../../components/AppButton.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppNotice from '../../components/AppNotice.vue'
import EmergencyEntry from '../../components/EmergencyEntry.vue'
import { useAuthStore } from '../../stores/auth'
import { getStatusBarHeight } from '../../utils/system'

/** 顶部三个价值芯片（文案按设计稿） */
const VALUE_CARDS: { title: string; desc: string }[] = [
  { title: '看懂报告', desc: '术语解释＋原文对照' },
  { title: '记录病程', desc: '低负担，保留来源' },
  { title: '准备复诊', desc: '一页摘要，可导出' },
]

/** 验证码倒计时总时长（秒） */
const COUNTDOWN_SECONDS = 60

const auth = useAuthStore()
const statusBarHeight = ref(0)

const phone = ref('')
const code = ref('')
/** 我已阅读并同意《用户协议》《隐私政策》（设计稿中默认勾选） */
const agreeTerms = ref(true)
/** 单独同意：处理我的健康信息（敏感个人信息），默认不勾选 */
const healthConsent = ref(false)
const sendingCode = ref(false)
const submitting = ref(false)
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | undefined

const codeActionText = computed(() =>
  countdown.value > 0 ? `${countdown.value} 秒后重试` : '获取验证码',
)

onMounted(() => {
  statusBarHeight.value = getStatusBarHeight()
  // 已登录用户进入应用直接进首页（tab 页）
  if (auth.isLoggedIn) {
    uni.reLaunch({ url: '/pages/index/index' })
  }
})

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})

function toast(title: string) {
  uni.showToast({ title, icon: 'none' })
}

function startCountdown() {
  countdown.value = COUNTDOWN_SECONDS
  countdownTimer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(countdownTimer)
      countdownTimer = undefined
    }
  }, 1000)
}

/** 获取验证码：POST /auth/sms-code（演示固定码 123456，手机号脱敏） */
async function onGetCode() {
  if (countdown.value > 0 || sendingCode.value) return
  if (!/^1\d{10}$/.test(phone.value.trim())) {
    toast('请输入正确的 11 位手机号')
    return
  }
  sendingCode.value = true
  try {
    const res = await auth.sendSmsCode(phone.value.trim())
    startCountdown()
    toast(`验证码已发送至 ${res.masked}（演示验证码 123456）`)
  } catch (e) {
    toast(e instanceof Error ? e.message : '验证码发送失败，请稍后重试')
  } finally {
    sendingCode.value = false
  }
}

/** 登录 / 注册：POST /auth/login → 单独同意健康信息处理 → 进首页 */
async function onLogin() {
  if (submitting.value) return
  if (!/^1\d{10}$/.test(phone.value.trim())) {
    toast('请输入正确的 11 位手机号')
    return
  }
  if (!/^\d{6}$/.test(code.value.trim())) {
    toast('请输入 6 位验证码')
    return
  }
  if (!agreeTerms.value) {
    toast('请先阅读并同意《用户协议》《隐私政策》')
    return
  }
  if (!healthConsent.value) {
    toast('请单独同意处理我的健康信息（含检查报告、症状记录）')
    return
  }

  submitting.value = true
  try {
    await auth.login(phone.value.trim(), code.value.trim())
    // 登录时把「单独同意健康信息处理」一起提交（可随时在「我的-数据与授权」撤回）
    try {
      await auth.grantConsent('健康信息处理')
    } catch {
      toast('已登录，但健康信息处理同意未提交，部分功能暂不可用')
    }
    uni.reLaunch({ url: '/pages/index/index' })
  } catch (e) {
    toast(e instanceof Error ? e.message : '登录失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="login-page">
    <!-- 状态栏占位（自定义导航栏） -->
    <view class="status-bar" :style="{ height: `${statusBarHeight}px` }" />

    <!-- 品牌区 -->
    <view class="brand">
      <view class="brand__logo">
        <text class="brand__logo-text">腰</text>
      </view>
      <text class="brand__name">腰有据</text>
      <text class="brand__slogan">腰痛理解与复诊助手</text>
    </view>

    <!-- 三个价值芯片 -->
    <view class="value-row">
      <view v-for="card in VALUE_CARDS" :key="card.title" class="value-card">
        <text class="value-card__title">{{ card.title }}</text>
        <text class="value-card__desc">{{ card.desc }}</text>
      </view>
    </view>

    <!-- 手机号 -->
    <view class="field">
      <text class="field__label">手机号</text>
      <view class="input-box">
        <input
          v-model="phone"
          class="input-box__control"
          type="number"
          maxlength="11"
          placeholder="请输入手机号"
          placeholder-class="input-box__placeholder"
        />
      </view>
    </view>

    <!-- 验证码 -->
    <view class="field">
      <text class="field__label">验证码</text>
      <view class="input-box input-box--code">
        <input
          v-model="code"
          class="input-box__control"
          type="number"
          maxlength="6"
          placeholder="6位验证码"
          placeholder-class="input-box__placeholder"
        />
        <text
          class="input-box__action"
          :class="{ 'input-box__action--disabled': countdown > 0 || sendingCode }"
          @click="onGetCode"
        >
          {{ codeActionText }}
        </text>
      </view>
    </view>

    <!-- 主按钮 -->
    <AppButton type="primary" block :loading="submitting" @click="onLogin">登录 / 注册</AppButton>

    <!-- 协议勾选 -->
    <view
      class="consent consent--terms"
      :class="{ 'consent--checked': agreeTerms }"
      hover-class="consent--hover"
      :hover-stay-time="80"
      @click="agreeTerms = !agreeTerms"
    >
      <view class="consent__box">
        <AppIcon v-if="agreeTerms" name="check" :size="14" />
      </view>
      <text class="consent__text">
        我已阅读并同意<text class="consent__link">《用户协议》</text><text class="consent__link">《隐私政策》</text>
      </text>
    </view>

    <view
      class="consent consent--health"
      :class="{ 'consent--checked': healthConsent }"
      hover-class="consent--hover"
      :hover-stay-time="80"
      @click="healthConsent = !healthConsent"
    >
      <view class="consent__box">
        <AppIcon v-if="healthConsent" name="check" :size="14" />
      </view>
      <text class="consent__text">
        单独同意：处理我的健康信息（含检查报告、症状记录，属敏感个人信息）。可随时在“我的-数据与授权”撤回。
      </text>
    </view>

    <!-- 信息提示条 -->
    <AppNotice type="info">
      本产品帮助你理解资料与准备复诊，不代替医生诊断，不提供处方或手术判断。
    </AppNotice>

    <!-- 就医提示条（不被登录阻断） -->
    <EmergencyEntry />
  </view>
</template>

<style lang="scss">
.login-page {
  min-height: 100vh;
  padding: 0 $spacing-page $spacing-xxl;
  background-color: $color-surface;
}

/* 状态栏占位（自定义导航栏，高度由系统信息决定） */
.status-bar {
  width: 100%;
}

/* ---------- 品牌区 ---------- */
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $spacing-xxl 0 $spacing-xl;
}

.brand__logo {
  width: 144rpx;
  height: 144rpx;
  border-radius: 40rpx;
  background-color: $color-primary;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand__logo-text {
  font-size: 68rpx;
  font-weight: $font-weight-medium;
  color: $color-surface;
  line-height: 1.1;
}

.brand__name {
  margin-top: $spacing-lg;
  font-size: 52rpx;
  font-weight: $font-weight-medium;
  color: $color-text-1;
  line-height: 1.3;
}

.brand__slogan {
  margin-top: $spacing-xs;
  font-size: 28rpx;
  color: $color-text-2;
  line-height: $line-height-body;
}

/* ---------- 三个价值芯片 ---------- */
.value-row {
  display: flex;
  gap: $spacing-sm;
  margin-bottom: $spacing-xl;
}

.value-card {
  flex: 1;
  min-width: 0;
  padding: $spacing-md $spacing-sm;
  border-radius: $radius-card;
  background-color: $color-bg;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-xs;
}

.value-card__title {
  font-size: 30rpx;
  font-weight: $font-weight-medium;
  color: $color-primary;
  line-height: 1.3;
}

.value-card__desc {
  font-size: 22rpx;
  color: $color-text-2;
  line-height: 1.4;
  text-align: center;
}

/* ---------- 输入框 ---------- */
.field {
  margin-bottom: $spacing-lg;
}

.field__label {
  display: block;
  margin-bottom: $spacing-sm;
  font-size: 28rpx;
  color: $color-text-1;
  line-height: 1.4;
}

.input-box {
  display: flex;
  align-items: center;
  min-height: 88rpx;
  padding: 0 $spacing-md;
  border: 1rpx solid $color-border;
  border-radius: 20rpx;
  background-color: $color-surface;
}

.input-box--code {
  gap: $spacing-sm;
}

.input-box__control {
  flex: 1;
  min-width: 0;
  height: 88rpx;
  font-size: 28rpx;
  color: $color-text-1;
  background-color: transparent;
}

.input-box__placeholder {
  font-size: 28rpx;
  color: $color-text-3;
}

.input-box__action {
  flex: none;
  font-size: 28rpx;
  font-weight: $font-weight-medium;
  color: $color-primary;
  line-height: 1.4;
  padding: $spacing-sm 0;
}

.input-box__action--disabled {
  color: $color-text-3;
  font-weight: $font-weight-regular;
}

/* ---------- 协议勾选 ---------- */
.consent {
  display: flex;
  align-items: flex-start;
  gap: $spacing-sm;
  margin-top: $spacing-md;
  padding: $spacing-md;
  border-radius: 20rpx;
  border: 1rpx solid $color-border;
  background-color: $color-surface;
}

.consent--terms {
  border-color: $color-primary;
  background-color: $color-primary-light;
}

.consent--hover {
  opacity: 0.9;
}

.consent__box {
  flex: none;
  width: 40rpx;
  height: 40rpx;
  margin-top: 2rpx;
  border-radius: 8rpx;
  border: 1rpx solid $color-text-3;
  background-color: $color-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-surface;
}

.consent--checked .consent__box {
  border-color: $color-primary;
  background-color: $color-primary;
}

.consent__text {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  color: $color-text-1;
  line-height: 1.5;
}

.consent__link {
  color: $color-primary;
}

/* ---------- 提示条与就医入口 ---------- */
.login-page .app-notice {
  margin-top: $spacing-lg;
}

.login-page .emergency-entry {
  margin-top: $spacing-md;
}
</style>
