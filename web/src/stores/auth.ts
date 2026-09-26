import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from '@/api/auth'
import { getToken, setToken } from '@/api/request'

/** 登录态（token 持久化到 localStorage） */
export const useAuthStore = defineStore('auth', () => {
  const token = ref(getToken())
  const userId = ref('')
  const phoneMasked = ref('')

  const isLoggedIn = computed(() => Boolean(token.value))

  async function login(phone: string, code: string) {
    const res = await authApi.login(phone, code)
    token.value = res.token
    setToken(res.token)
    userId.value = res.user.id
    phoneMasked.value = res.user.phone_masked
    return res
  }

  /** 登录时把「单独同意健康信息处理」一起提交（可随时撤回） */
  async function grantConsent(scope: string) {
    return authApi.grantConsent(scope)
  }

  async function fetchMe() {
    const res = await authApi.me()
    userId.value = res.id
    phoneMasked.value = res.phone_masked
    return res
  }

  function logout() {
    token.value = ''
    userId.value = ''
    phoneMasked.value = ''
    setToken('')
  }

  return { token, userId, phoneMasked, isLoggedIn, login, grantConsent, fetchMe, logout }
})
