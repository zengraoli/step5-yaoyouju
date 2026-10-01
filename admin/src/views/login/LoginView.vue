<script setup lang="ts">
/**
 * B01 后台登录（含 MFA）（设计稿 docs/design/admin/B01.png，设计宽度 1440）
 *
 * 账号密码 + TOTP；无自助注册；连续失败 5 次锁定 30 分钟；短会话 30 分钟；
 * 所有登录与敏感操作写入审计日志。
 *
 * 数据来自 server 接口：POST /admin/auth/login
 */
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppNotice from '@/components/AppNotice.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const name = ref('')
const password = ref('')
const totp = ref('')
const submitting = ref(false)
const errorText = ref('')

async function onSubmit() {
  if (submitting.value) return
  if (!name.value.trim()) {
    errorText.value = '请输入账号'
    return
  }
  if (!password.value) {
    errorText.value = '请输入密码'
    return
  }
  if (!/^\d{6}$/.test(totp.value.trim())) {
    errorText.value = '请输入 6 位动态验证码'
    return
  }
  submitting.value = true
  errorText.value = ''
  try {
    await auth.login(name.value.trim(), password.value, totp.value.trim())
    const redirect = (route.query.redirect as string) || '/dashboard'
    router.push(redirect)
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '登录失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-brand">
      <span class="login-brand__logo">腰</span>
      <span class="login-brand__text">腰有据 · 后台管理系统</span>
    </div>

    <div class="login-card">
      <div class="login-card__head">
        <h1 class="login-card__title">登录</h1>
        <span class="login-card__env">演示环境</span>
      </div>
      <p class="login-card__desc">仅限受邀成员；不提供自助注册。登录需账号密码 + 动态验证码（MFA）。</p>

      <form class="login-form" @submit.prevent="onSubmit">
        <label class="field">
          <span class="field__label">账号</span>
          <span class="field__box">
            <span class="field__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12.6a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4z" /><path d="M4.8 20.4c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6" /></svg>
            </span>
            <input v-model="name" class="field__input" type="text" placeholder="工作邮箱" autocomplete="username" />
          </span>
        </label>

        <label class="field">
          <span class="field__label">密码</span>
          <span class="field__box">
            <span class="field__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.4" width="14" height="9.6" rx="2" /><path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8" /></svg>
            </span>
            <input v-model="password" class="field__input" type="password" placeholder="••••••••" autocomplete="current-password" />
          </span>
        </label>

        <label class="field">
          <span class="field__label">动态验证码（TOTP）</span>
          <span class="field__box">
            <span class="field__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4 5 6v5.4c0 4.4 3 7.6 7 9.2 4-1.6 7-4.8 7-9.2V6z" /></svg>
            </span>
            <input v-model="totp" class="field__input" type="text" inputmode="numeric" maxlength="6" placeholder="6 位验证码" />
          </span>
        </label>

        <AppNotice v-if="errorText" type="error">{{ errorText }}</AppNotice>

        <AppButton type="primary" block :loading="submitting">登录</AppButton>
      </form>

      <AppNotice type="info">
        连续失败 5 次锁定 30 分钟；会话 30 分钟到期即失效；所有登录与敏感操作写入审计日志。
        新成员首次登录需先绑定动态验证码（MFA）才能操作。
      </AppNotice>

      <p class="login-card__foot">忘记密码或未绑定 MFA？请联系超级管理员重置。</p>
    </div>

    <p class="login-page__foot">后台域名与用户端分离 · 独立证书与会话 · 数据区不可公网访问</p>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  background: var(--color-dark);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xl);
  padding: var(--spacing-xxl);
}

.login-brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: #fff;
}

.login-brand__logo {
  width: 36px;
  height: 36px;
  border-radius: 20%;
  background: var(--color-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-weight-medium);
}

.login-brand__text {
  font-size: var(--font-size-card-title);
  font-weight: var(--font-weight-medium);
}

.login-card {
  width: 420px;
  max-width: 100%;
  background: var(--color-surface);
  border-radius: var(--radius-card);
  padding: var(--spacing-xxl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.login-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.login-card__head h1 {
  margin: 0;
  font-size: var(--font-size-page-title);
  font-weight: var(--font-weight-medium);
}

.login-card__env {
  padding: 2px 8px;
  border-radius: var(--radius-tag);
  background: var(--color-error-light);
  color: var(--color-error);
  font-size: var(--font-size-aux-sm);
}

.login-card__desc {
  margin: calc(-1 * var(--spacing-sm)) 0 0;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.field {
  display: block;
}

.field__label {
  display: block;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-2);
  margin-bottom: var(--spacing-xs);
}

.field__box {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-height: 40px;
  padding: 0 var(--spacing-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
}

.field__box:focus-within {
  border-color: var(--color-primary);
}

.field__icon {
  color: var(--color-text-3);
  flex-shrink: 0;
}

.field__input {
  flex: 1;
  border: none;
  outline: none;
  font-family: inherit;
  font-size: var(--font-size-body);
  color: var(--color-text-1);
  min-width: 0;
}

.login-card__foot {
  margin: 0;
  text-align: center;
  font-size: var(--font-size-aux-sm);
  color: var(--color-text-3);
}

.login-page__foot {
  margin: 0;
  font-size: var(--font-size-aux-sm);
  color: rgba(255, 255, 255, 0.45);
}
</style>
