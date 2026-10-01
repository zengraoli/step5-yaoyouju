<script setup lang="ts">
/**
 * 绑定动态验证码（MFA）：新邀请成员 / 重置 MFA 后的账号首次登录必须绑定后才能操作后台。
 * 演示实现：演示固定码即完成绑定；绑定后才能访问其他后台接口（服务端统一拦截）。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppNotice from '@/components/AppNotice.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const totp = ref('')
const submitting = ref(false)
const errorText = ref('')
const done = ref(false)

async function onSubmit() {
  if (submitting.value) return
  if (!/^\d{6}$/.test(totp.value.trim())) {
    errorText.value = '请输入 6 位动态验证码'
    return
  }
  submitting.value = true
  errorText.value = ''
  try {
    await auth.bindMfa(totp.value.trim())
    done.value = true
    setTimeout(() => router.push('/dashboard'), 800)
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '绑定失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="bind-page">
    <div class="bind-card">
      <h1 class="bind-card__title">绑定动态验证码</h1>
      <p class="bind-card__desc">
        首次登录需先绑定动态验证码（MFA），绑定后才能操作后台。演示环境使用演示固定码。
      </p>
      <form class="bind-form" @submit.prevent="onSubmit">
        <label class="field">
          <span class="field__label">动态验证码</span>
          <span class="field__box">
            <input v-model="totp" class="field__input" type="text" inputmode="numeric" maxlength="6" placeholder="6 位验证码" />
          </span>
        </label>
        <AppNotice v-if="errorText" type="error">{{ errorText }}</AppNotice>
        <AppNotice v-if="done" type="info">已绑定，正在进入后台…</AppNotice>
        <AppButton type="primary" block :loading="submitting">绑定并进入后台</AppButton>
      </form>
    </div>
  </div>
</template>

<style scoped>
.bind-page {
  min-height: 100vh;
  background: var(--color-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xxl);
}

.bind-card {
  width: min(420px, 100%);
  background: var(--color-surface);
  border-radius: var(--radius-card);
  padding: var(--spacing-xxl);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.bind-card__title {
  margin: 0;
  font-size: var(--font-size-page-title);
}

.bind-card__desc {
  margin: 0;
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
  line-height: var(--line-height-body);
}

.bind-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.field__label {
  font-size: var(--font-size-aux);
  color: var(--color-text-2);
}

.field__box {
  display: flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-button);
  padding: 0 var(--spacing-md);
}

.field__input {
  flex: 1;
  min-height: 44px;
  border: none;
  outline: none;
  font-size: var(--font-size-body);
  font-family: inherit;
  background: transparent;
  color: var(--color-text-1);
}
</style>
