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

/** 内容版本（版本链） */
export interface ContentVersionView {
  version: number
  script: string
  subtitle_text: string
  asset_key: string | null
  published_at: string | null
  is_current: boolean
}

/** 审核记录 */
export interface ReviewRecordView {
  id: string
  decision: string
  review_scope: string | null
  comment: string | null
  reviewer_id: string | null
  reviewer_name: string | null
  reviewed_at: string
}

/** 内容详情：适用范围、版本、审核记录、下线开关、字幕与文字替代 */
export interface ContentDetail {
  id: string
  type: string
  title: string
  applicable_scope: string
  not_applicable: string
  current_status: string
  offline: boolean
  current_version: {
    version: number
    script: string
    subtitle_text: string
    asset_key: string | null
    published_at: string
  } | null
  versions: ContentVersionView[]
  review_records: ReviewRecordView[]
  disclaimer: string
}

/** 内容详情（已下线 / 非已发布返回 404） */
export function getContentDetail(contentId: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/contents/${encodeURIComponent(contentId)}` })
}
