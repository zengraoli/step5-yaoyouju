import { request } from './request'

/**
 * 功能开关（对应 server switches.controller.ts）
 * GET /switches —— 公开接口：个性化分析 / 视频推荐 / 拍照提取 / 案例卡片
 */

export interface SwitchItem {
  key: string
  enabled: boolean
  reason: string | null
  updated_at: string
}

/** 功能开关状态（公开，不携带用户数据） */
export function getSwitches(): Promise<SwitchItem[]> {
  return request<SwitchItem[]>({ url: '/switches', auth: false })
}
