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

/** 就医提示内容（公开；命中的信号名随请求带入，正文不写死任何症状） */
export function getEmergencyNotice(signals?: string[], stop = false): Promise<EmergencyNotice> {
  let url = '/safety/emergency-notice'
  const q: string[] = []
  if (signals && signals.length > 0) q.push(`signals=${encodeURIComponent(signals.join('、'))}`)
  if (stop) q.push('stop=1')
  if (q.length > 0) url += `?${q.join('&')}`
  return request<EmergencyNotice>({ url, auth: false })
}
