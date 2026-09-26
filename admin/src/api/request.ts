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
  const saved = localStorage.getItem(STORAGE_KEYS.baseUrl)
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '')
  return DEFAULT_API_BASE_URL
}

export function getAdminToken(): string {
  return localStorage.getItem(STORAGE_KEYS.adminToken) ?? ''
}

export function setAdminToken(token: string): void {
  if (token) localStorage.setItem(STORAGE_KEYS.adminToken, token)
  else localStorage.removeItem(STORAGE_KEYS.adminToken)
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
    throw new Error(body.message || '请求失败，请稍后重试')
  }
  throw new Error(`服务暂时不可用（${res.status}），请稍后重试`)
}
