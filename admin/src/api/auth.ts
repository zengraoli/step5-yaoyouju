import { request } from './request'

/**
 * 后台认证（对应 server admin.controller.ts）
 * POST /admin/auth/login（账号 + 密码 + TOTP）、GET /admin/auth/me、
 * POST /admin/auth/logout；无自助注册。
 */

export interface AdminLoginInput {
  name: string
  password: string
  totp: string
}

export interface AdminProfile {
  id: string
  name: string
  role: { id: string; name: string }
  permissions: string[]
  mfa_enabled?: boolean
}

export interface AdminLoginResult {
  token: string
  admin: AdminProfile
  expires_in?: number
}

/** 登录（连续失败 5 次锁定 30 分钟；演示 TOTP 固定码见 .env.example） */
export function adminLogin(input: AdminLoginInput): Promise<AdminLoginResult> {
  return request<AdminLoginResult>({
    url: '/admin/auth/login',
    method: 'POST',
    data: { ...input },
    auth: false,
  })
}

/** 当前后台账号（角色与权限） */
export function adminMe(): Promise<AdminProfile> {
  return request<AdminProfile>({ url: '/admin/auth/me' })
}

/** 登出（写审计） */
export function adminLogout(): Promise<unknown> {
  return request({ url: '/admin/auth/logout', method: 'POST' })
}
