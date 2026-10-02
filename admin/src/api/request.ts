import { DEFAULT_API_BASE_URL, STORAGE_KEYS } from '@/utils/constants'

/** 统一请求封装（后台：Bearer admin token） */
export interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  data?: unknown
  auth?: boolean
}

export function getBaseUrl(): string {
  const saved = sessionStorage.getItem(STORAGE_KEYS.baseUrl)
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '')
  return DEFAULT_API_BASE_URL
}

/** 设置 API 基础地址（同一会话内生效） */
export function setBaseUrl(url: string): void {
  sessionStorage.setItem(STORAGE_KEYS.baseUrl, url.trim().replace(/\/+$/, ''))
}

/**
 * 后台令牌存放策略：只放 sessionStorage（同一标签页会话内有效，关闭页面即失效），
 * 不写 localStorage（验收反馈：后台令牌不应长期驻留本地存储）。
 */
export function getAdminToken(): string {
  return sessionStorage.getItem(STORAGE_KEYS.adminToken) ?? ''
}

export function setAdminToken(token: string): void {
  if (token) sessionStorage.setItem(STORAGE_KEYS.adminToken, token)
  else sessionStorage.removeItem(STORAGE_KEYS.adminToken)
}

/** 带业务数据的接口错误（确认单 ID 等随 40900 返回，前端据此继续双人确认流程） */
export class ApiError extends Error {
  code: number
  data: unknown
  constructor(message: string, code: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.data = data
  }
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, auth = true } = options
  const token = getAdminToken()
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
    throw new ApiError(body.message || '请求失败，请稍后重试', body.code, body.data)
  }
  throw new Error(`服务暂时不可用（${res.status}），请稍后重试`)
}
