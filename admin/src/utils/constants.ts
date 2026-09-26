/** 本地存储键名与 API 默认地址（不出现任何账号 / 密码 / 令牌） */
export const STORAGE_KEYS = {
  adminToken: 'yyj_admin_token',
  baseUrl: 'yyj_admin_api_base_url',
} as const

/** API 基础地址默认值（本地 server） */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3200'
