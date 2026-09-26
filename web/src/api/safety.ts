import { request } from './request'

/** 就医提示（公开接口，无需登录；R03：不被登录阻断） */
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

export function getEmergencyNotice(): Promise<EmergencyNotice> {
  return request<EmergencyNotice>({ url: '/safety/emergency-notice', auth: false })
}
