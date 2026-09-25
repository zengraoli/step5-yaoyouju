import { DEFAULT_API_BASE_URL, STORAGE_KEYS } from '../utils/constants'

/**
 * 统一请求封装
 * - baseURL 可配置（默认 http://127.0.0.1:3200，可在「我的」页切换）
 * - 自动携带 Authorization: Bearer <token>
 * - 统一处理响应体 { code, data, message }：code 为 0 时 resolve data，否则 reject 中文 message
 */

/** 后端统一响应体 */
export interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

export interface RequestOptions {
  /** 接口路径，如 /auth/login */
  url: string
  method?: 'GET' | 'POST'
  data?: Record<string, unknown>
  /** 是否需要登录态，默认 true；公开接口（验证码 / 登录 / 就医提示 / 开关）传 false */
  auth?: boolean
}

/** 当前 API 基础地址：本地存储优先，其次默认值 */
export function getBaseUrl(): string {
  const saved = uni.getStorageSync(STORAGE_KEYS.baseUrl)
  if (typeof saved === 'string' && saved.trim()) {
    return saved.trim().replace(/\/+$/, '')
  }
  return DEFAULT_API_BASE_URL
}

/** 设置 API 基础地址（演示时切换到其他后端） */
export function setBaseUrl(url: string): void {
  uni.setStorageSync(STORAGE_KEYS.baseUrl, url.trim().replace(/\/+$/, ''))
}

/** 读取本地持久化的 token */
export function getToken(): string {
  const token = uni.getStorageSync(STORAGE_KEYS.token)
  return typeof token === 'string' ? token : ''
}

/** 统一请求：网络异常 / 业务错误均以中文 message reject，页面 try-catch 后直接提示 */
export function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, auth = true } = options
  const token = getToken()
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: getBaseUrl() + url,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success: (res) => {
        const body = res.data as ApiResponse<T> | undefined
        if (res.statusCode >= 200 && res.statusCode < 300 && body && typeof body === 'object') {
          if (body.code === 0) {
            resolve(body.data)
          } else {
            // 业务错误：code 非 0，message 为中文
            reject(new Error(body.message || '请求失败，请稍后重试'))
          }
        } else {
          reject(new Error(`服务暂时不可用（${res.statusCode}），请稍后重试`))
        }
      },
      fail: () => {
        reject(new Error('网络连接失败，请检查网络后重试'))
      },
    })
  })
}
