import { defineStore } from 'pinia'
import * as authApi from '../api/auth'
import type { ConsentItem, LoginResult, MeResult } from '../api/auth'
import { STORAGE_KEYS } from '../utils/constants'

/**
 * 登录态（Pinia）
 * - token 持久化到 uni.storage（键名见 utils/constants.ts）
 * - 用户信息、同意记录来自 server 接口（/auth/me、/auth/consents）
 * - 同意「健康信息处理」需单独勾选，可查可撤回（产品红线）
 */
interface AuthState {
  token: string
  userId: string
  /** 脱敏手机号（138****1234） */
  phoneMasked: string
  consents: ConsentItem[]
  /** 是否已从本地存储恢复（启动时调用 restore） */
  restored: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: '',
    userId: '',
    phoneMasked: '',
    consents: [],
    restored: false,
  }),

  getters: {
    /** 是否已登录 */
    isLoggedIn: (state): boolean => Boolean(state.token),
    /** 是否已单独同意「健康信息处理」 */
    healthConsentGranted: (state): boolean =>
      state.consents.some((c) => c.scope === '健康信息处理' && c.granted),
    /** 指定范围是否已同意 */
    consentGranted:
      (state) =>
      (scope: string): boolean =>
        state.consents.some((c) => c.scope === scope && c.granted),
  },

  actions: {
    /** 从本地存储恢复 token（App.onLaunch 调用） */
    restore(): void {
      const token = uni.getStorageSync(STORAGE_KEYS.token)
      this.token = typeof token === 'string' ? token : ''
      this.restored = true
    },

    /** 手机号 + 验证码登录，成功后写入登录态 */
    async login(phone: string, code: string): Promise<LoginResult> {
      const res = await authApi.login(phone, code)
      this.applyLogin(res)
      return res
    },

    /** 获取短信验证码（演示固定码 123456，返回脱敏手机号） */
    async sendSmsCode(phone: string): Promise<{ sent: boolean; masked: string }> {
      return authApi.sendSmsCode(phone)
    },

    applyLogin(res: LoginResult): void {
      this.token = res.token
      this.userId = res.user.id
      this.phoneMasked = res.user.phone_masked
      this.consents = res.consents ?? []
      uni.setStorageSync(STORAGE_KEYS.token, res.token)
    },

    /** 拉取当前用户信息与同意记录 */
    async fetchMe(): Promise<MeResult> {
      const res = await authApi.me()
      this.userId = res.id
      this.phoneMasked = res.phone_masked
      this.consents = res.consents ?? []
      return res
    },

    /** 已登录时静默刷新（App.onShow 调用；网络异常不打断使用） */
    async refreshIfLoggedIn(): Promise<void> {
      if (!this.token) return
      try {
        await this.fetchMe()
      } catch {
        // 登录过期或网络异常时保持现状，由具体页面引导重新登录
      }
    },

    /** 同意某项范围（单独勾选，如健康信息处理） */
    async grantConsent(scope: string): Promise<void> {
      this.consents = await authApi.grantConsent(scope)
    },

    /** 撤回某项同意（立即生效） */
    async revokeConsent(scope: string): Promise<void> {
      this.consents = await authApi.revokeConsent(scope)
    },

    /** 登出：清除本地登录态 */
    logout(): void {
      this.token = ''
      this.userId = ''
      this.phoneMasked = ''
      this.consents = []
      uni.removeStorageSync(STORAGE_KEYS.token)
    },
  },
})
