/** 全局常量：本地存储键名与 API 默认地址（不出现任何账号 / 密码 / 令牌） */

/** uni.storage 键名（登录态与接口地址持久化） */
export const STORAGE_KEYS = {
  /** 登录 token */
  token: 'yyj_token',
  /** API 基础地址（可在「我的」页切换，默认指向本地 server） */
  baseUrl: 'yyj_api_base_url',
} as const

/** API 基础地址默认值（本地 server，见 server/README.md） */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3200'
