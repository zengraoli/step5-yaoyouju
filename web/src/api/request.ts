import { DEFAULT_API_BASE_URL, STORAGE_KEYS } from '@/utils/constants'

/**
 * 统一请求封装（与 App 端行为一致）
 * - baseURL 可配置（默认 http://127.0.0.1:3200）
 * - 自动携带 Authorization: Bearer <token>
 * - 统一处理 { code, data, message }：code 为 0 时 resolve data，否则 reject 中文 message
 */

/** 后端统一响应体 */
export interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  data?: unknown
  /** 是否需要登录态，默认 true */
  auth?: boolean
}

/** 业务错误（code 非 0）：message 为中文；安全规则等异常附带结构化 data */
export interface ApiError extends Error {
  code?: number
  data?: unknown
}

/** 读取业务错误附带的结构化 data（无则返回 undefined） */
export function apiErrorData(error: unknown): unknown {
  return error instanceof Error ? (error as ApiError).data : undefined
}

export function getBaseUrl(): string {
  const saved = localStorage.getItem(STORAGE_KEYS.baseUrl)
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '')
  return DEFAULT_API_BASE_URL
}

export function setBaseUrl(url: string): void {
  localStorage.setItem(STORAGE_KEYS.baseUrl, url.trim().replace(/\/+$/, ''))
}

export function getToken(): string {
  return localStorage.getItem(STORAGE_KEYS.token) ?? ''
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(STORAGE_KEYS.token, token)
  else localStorage.removeItem(STORAGE_KEYS.token)
}

/** 统一请求：网络异常 / 业务错误均以中文 message reject */
export async function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, auth = true } = options
  const token = getToken()
  // GET/HEAD 不允许带 body：查询参数拼到 URL 上
  let target = getBaseUrl() + url
  let payload: string | undefined
  if (data && method !== 'GET') {
    payload = JSON.stringify(data)
  } else if (data && method === 'GET') {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v))
    }
    const q = qs.toString()
    if (q) target += (target.includes('?') ? '&' : '?') + q
  }
  let res: Response
  try {
    res = await fetch(target, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: payload,
    })
  } catch {
    throw new Error('网络连接失败，请检查网络后重试')
  }
  const text = await res.text()
  let body: ApiResponse<T> | null = null
  try {
    body = text ? (JSON.parse(text) as ApiResponse<T>) : null
  } catch {
    body = null
  }
  if (body && typeof body === 'object' && typeof body.code === 'number') {
    if (body.code === 0) return body.data
    const err = new Error(body.message || '请求失败，请稍后重试') as ApiError
    err.code = body.code
    err.data = body.data
    throw err
  }
  throw new Error(`服务暂时不可用（${res.status}），请稍后重试`)
}
