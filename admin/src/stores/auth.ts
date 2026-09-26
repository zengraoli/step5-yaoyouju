import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from '@/api/auth'
import { getAdminToken, setAdminToken } from '@/api/request'

/** 后台登录态（token 持久化到 localStorage；短会话 30 分钟） */
export const useAuthStore = defineStore('auth', () => {
  const token = ref(getAdminToken())
  const admin = ref<authApi.AdminProfile | null>(null)

  const isLoggedIn = computed(() => Boolean(token.value))
  const role = computed(() => admin.value?.role.name ?? '')
  const permissions = computed<string[]>(() => admin.value?.permissions ?? [])

  async function login(name: string, password: string, totp: string) {
    const res = await authApi.adminLogin({ name, password, totp })
    token.value = res.token
    setAdminToken(res.token)
    admin.value = res.admin
    return res
  }

  async function fetchMe() {
    const res = await authApi.adminMe()
    admin.value = res
    return res
  }

  function hasPermission(permission: string): boolean {
    return permissions.value.includes('*') || permissions.value.includes(permission)
  }

  function logout() {
    token.value = ''
    admin.value = null
    setAdminToken('')
  }

  return { token, admin, isLoggedIn, role, permissions, login, fetchMe, hasPermission, logout }
})
