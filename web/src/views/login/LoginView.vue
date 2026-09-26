<script setup lang="ts">
/**
 * W01 登录与授权（设计稿 docs/design/web/W01.png，设计宽度 1440）
 *
 * 左侧价值说明（主色整幅）：品牌 + 副标题 + 说明 + 三个价值项；
 * 右侧登录卡 440px：手机号 / 验证码 / 登录按钮 / 两条协议勾选 / 提示条。
 *
 * 产品红线：
 * - 「单独同意：处理我的健康信息」独立勾选、默认不勾选，登录时一并提交，可随时撤回；
 * - 就医提示入口不被登录阻断（页脚与红色提示条均可进入，无需登录）。
 *
 * 数据全部来自 server 接口（/auth/sms-code、/auth/login、/auth/consents）。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppInput from '@/components/AppInput.vue'
import AppNotice from '@/components/AppNotice.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { sendSmsCode } from '@/api/auth'

/** 左侧三个价值项（文案按设计稿） */
const VALUE_ITEMS = [
  { key: 'report', title: '看懂报告', desc: '术语解释逐句对应原文；报告未提及的内容不会被写成“已排除”' },
  { key: 'course', title: '记录病程', desc: '低负担记录，保留来源、时间与核实状态' },
  { key: 'followup', title: '准备复诊', desc: '一页交接摘要，预览后由你自主导出' },
]

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const phone = ref('')
const code = ref('')
/** 我已阅读并同意《用户协议》《隐私政策》（设计稿中默认勾选） */
const agreeTerms = ref(true)
/** 单独同意：处理我的健康信息（敏感个人信息），默认不勾选 */
const healthConsent = ref(false)
const sendingCode = ref(false)
const submitting = ref(false)
const countdown = ref(0)
let timer: number | undefined

const codeActionText = computed(() => (countdown.value > 0 ? `${countdown.value} 秒后重试` : '获取验证码'))

function toast(title: string) {
  alert(title)
}

function startCountdown() {
  countdown.value = 60
  timer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && timer) {
      window.clearInterval(timer)
      timer = undefined
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
    const res = await sendSmsCode(phone.value.trim())
    startCountdown()
    toast(`验证码已发送至 ${res.masked}（演示验证码 123456）`)
  } catch (e) {
    toast(e instanceof Error ? e.message : '验证码发送失败，请稍后重试')
  } finally {
    sendingCode.value = false
  }
}

/** 登录 / 注册：POST /auth/login → 单独同意健康信息处理 → 进入首页 */
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
    try {
      await auth.grantConsent('健康信息处理')
    } catch {
      toast('已登录，但健康信息处理同意未提交，部分功能暂不可用')
    }
    const redirect = (route.query.redirect as string) || '/dashboard'
    router.push(redirect)
  } catch (e) {
    toast(e instanceof Error ? e.message : '登录失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <!-- 左侧：价值说明 -->
    <section class="login-aside">
      <div class="login-aside__inner">
        <BrandLogo size="lg" />
        <p class="login-aside__slogan">腰痛理解与复诊助手</p>
        <p class="login-aside__desc">
          把检查报告、当前症状、病程变化和最困扰你的问题连接起来，说明“已经知道什么、仍不知道什么、接下来怎么办”。帮助你理解和复诊，不代替医生诊断。
        </p>
        <ul class="value-list">
          <li v-for="item in VALUE_ITEMS" :key="item.key" class="value-item">
            <span class="value-item__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="M8.5 12.5h7M12 9v7" />
              </svg>
            </span>
            <span class="value-item__body">
              <span class="value-item__title">{{ item.title }}</span>
              <span class="value-item__desc">{{ item.desc }}</span>
            </span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 右侧：登录卡 -->
    <section class="login-main">
      <div class="login-card">
        <h1 class="login-card__title">登录 / 注册</h1>
        <p class="login-card__subtitle">使用手机号验证码登录；首次登录即注册。</p>

        <form class="login-form" @submit.prevent="onLogin">
          <AppInput v-model="phone" label="手机号" type="number" placeholder="请输入手机号" :maxlength="11" />

          <div class="login-form__code">
            <AppInput v-model="code" label="验证码" type="number" placeholder="6位验证码" :maxlength="6" />
            <button
              class="login-form__code-action"
              type="button"
              :disabled="countdown > 0 || sendingCode"
              @click="onGetCode"
            >
              {{ codeActionText }}
            </button>
          </div>

          <AppButton type="primary" block :loading="submitting">登录 / 注册</AppButton>
        </form>

        <!-- 协议勾选 -->
        <label class="consent" :class="{ 'consent--checked': agreeTerms }">
          <input v-model="agreeTerms" class="consent__checkbox" type="checkbox" />
          <span class="consent__box" :class="{ 'consent__box--checked': agreeTerms }" aria-hidden="true" />
          <span class="consent__text">我已阅读并同意《用户协议》《隐私政策》</span>
        </label>

        <label class="consent" :class="{ 'consent--checked': healthConsent }">
          <input v-model="healthConsent" class="consent__checkbox" type="checkbox" />
          <span class="consent__box" :class="{ 'consent__box--checked': healthConsent }" aria-hidden="true" />
          <span class="consent__text">
            单独同意：处理我的健康信息（含检查报告、症状记录，属敏感个人信息）。可随时在“账户与数据”撤回。
          </span>
        </label>

        <AppNotice type="info">
          本产品帮助你理解资料与准备复诊，不代替医生诊断，不提供处方或手术判断。
        </AppNotice>

        <!-- 就医提示：不被登录阻断 -->
        <RouterLink to="/emergency" class="emergency-entry">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3.8 2.9 19.6h18.2z" />
            <path d="M12 9.6v4.2M12 16.6v.6" />
          </svg>
          出现严重症状？无需登录，立即查看就医提示
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

/* ---------- 左侧价值说明 ---------- */
.login-aside {
  background: var(--color-primary);
  color: var(--color-surface);
  display: flex;
  align-items: center;
  padding: var(--spacing-xxl) 64px;
}

.login-aside__inner {
  max-width: 520px;
}

.login-aside :deep(.brand__name) {
  color: var(--color-surface);
}

.login-aside :deep(.brand__logo) {
  background: rgba(255, 255, 255, 0.16);
}

.login-aside__slogan {
  margin: var(--spacing-xl) 0 var(--spacing-md);
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.login-aside__desc {
  margin: 0 0 var(--spacing-xxl);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
  color: rgba(255, 255, 255, 0.85);
}

.value-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
}

.value-item {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-md);
}

.value-item__icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-button);
  background: rgba(255, 255, 255, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.value-item__body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.value-item__title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
}

.value-item__desc {
  font-size: var(--font-size-aux-sm);
  color: rgba(255, 255, 255, 0.8);
  line-height: var(--line-height-body);
}

/* ---------- 右侧登录卡 ---------- */
.login-main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xxl);
}

.login-card {
  width: 440px;
  max-width: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: var(--spacing-xxl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  box-shadow: 0 8px 24px rgba(27, 34, 48, 0.06);
}

.login-card__title {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-1);
}

.login-card__subtitle {
  margin: calc(-1 * var(--spacing-sm)) 0 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.login-form__code {
  position: relative;
}

.login-form__code-action {
  position: absolute;
  right: 0;
  bottom: 12px;
  background: none;
  border: none;
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-aux);
  font-family: inherit;
  color: var(--color-primary);
  cursor: pointer;
}

.login-form__code-action:disabled {
  color: var(--color-text-3);
  cursor: not-allowed;
}

/* ---------- 协议勾选 ---------- */
.consent {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  cursor: pointer;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.consent__checkbox {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.consent__box {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-tag);
  background: var(--color-surface);
  flex-shrink: 0;
  position: relative;
  transition: background-color 0.15s, border-color 0.15s;
}

.consent__box--checked {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.consent__box--checked::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 9px;
  border: solid var(--color-surface);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.consent__text {
  flex: 1;
}

/* ---------- 就医入口 ---------- */
.emergency-entry {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 44px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-error-light);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-button);
  color: var(--color-error);
  font-size: var(--font-size-aux-sm);
  text-decoration: none;
}

.emergency-entry:hover {
  opacity: 0.9;
}

/* ---------- 响应式 ---------- */
@media (max-width: 960px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-aside {
    padding: var(--spacing-xxl);
  }
}
</style>
