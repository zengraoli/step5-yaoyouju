import { request } from './request'

/**
 * 就医提示（对应 server safety.controller.ts）
 * GET /safety/emergency-notice —— 公开接口：无需登录，不被付费 / 上传 / 长问卷阻断。
 * 命中红旗信号时展示；网络异常时前端展示本页静态内容（见 pages/emergency/notice）。
 */

export interface EmergencyNotice {
  title: string
  headline: string
  body: string
  offline_note: string
  actions: { type: string; label: string }[]
  bring_list: string[]
  summary_action: { label: string }
  footer_note: string
}

/** 就医提示内容（公开） */
export function getEmergencyNotice(): Promise<EmergencyNotice> {
  return request<EmergencyNotice>({ url: '/safety/emergency-notice', auth: false })
}
