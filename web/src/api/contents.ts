import { request } from './request'

/**
 * 内容库（对应 server contents.controller.ts）
 * GET /contents —— 只返回已发布且未下线的内容，每条带适用范围、不适用范围、
 * 当前版本号与推荐理由（推荐理由由服务端按用户病程关键词计算）。
 */

export interface ContentListItem {
  id: string
  /** 视频 / 图文组件 / 案例 */
  type: string
  title: string
  applicable_scope: string
  not_applicable: string
  /** 当前生效（已发布）版本号 */
  version: number | null
  published_at: string | null
  /** 推荐理由（服务端生成，用户可见） */
  recommend_reason: string
}

/** 已发布内容列表（可按类型筛选） */
export function listContents(type?: string): Promise<ContentListItem[]> {
  return request<ContentListItem[]>({ url: '/contents', data: type ? { type } : undefined })
}
