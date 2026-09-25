import { request } from './request'

/**
 * 认证与同意（对应 server auth.controller.ts）
 * POST /auth/sms-code、POST /auth/login、GET /auth/me、
 * GET/POST /auth/consents、POST /auth/consents/:scope/revoke
 */

/** 同意范围（与后端 CONSENT_SCOPES 一致） */
export const CONSENT_SCOPES = ['健康信息处理', '分享', '产品改进'] as const
export type ConsentScope = (typeof CONSENT_SCOPES)[number]

/** 单条同意记录：可查、可撤回 */
export interface ConsentItem {
  id: string
  scope: string
  granted: boolean
  granted_at: string
  revoked_at: string | null
}

export interface LoginResult {
  token: string
  user: { id: string; phone_masked: string }
  consents: ConsentItem[]
}

export interface MeResult {
  id: string
  phone_masked: string
  real_name_masked: string | null
  created_at: string
  consents: ConsentItem[]
}

/** 获取短信验证码（演示固定码 123456，手机号脱敏） */
export function sendSmsCode(phone: string): Promise<{ sent: boolean; masked: string }> {
  return request({ url: '/auth/sms-code', method: 'POST', data: { phone }, auth: false })
}

/** 手机号 + 验证码登录 / 注册（首次自动创建用户） */
export function login(phone: string, code: string): Promise<LoginResult> {
  return request({ url: '/auth/login', method: 'POST', data: { phone, code }, auth: false })
}

/** 当前登录用户信息与同意记录 */
export function me(): Promise<MeResult> {
  return request({ url: '/auth/me' })
}

/** 我的同意记录（可查） */
export function listConsents(): Promise<ConsentItem[]> {
  return request({ url: '/auth/consents' })
}

/** 同意某项范围（单独勾选，如健康信息处理） */
export function grantConsent(scope: string): Promise<ConsentItem[]> {
  return request({ url: '/auth/consents', method: 'POST', data: { scope } })
}

/** 撤回同意（立即生效） */
export function revokeConsent(scope: string): Promise<ConsentItem[]> {
  return request({ url: `/auth/consents/${encodeURIComponent(scope)}/revoke`, method: 'POST' })
}
