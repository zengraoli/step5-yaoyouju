/** 本地存储键名与 API 默认地址（不出现任何账号 / 密码 / 令牌） */
export const STORAGE_KEYS = {
  token: 'yyj_web_token',
  baseUrl: 'yyj_web_api_base_url',
} as const

/** API 基础地址默认值（本地 server，见 server/README.md） */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3200'
