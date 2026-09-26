import { request } from './request'

/**
 * 后台内容库（对应 server admin-contents.controller.ts）
 * 状态机流转：草稿 → 待医学审核 → 已审定 → 已发布 → 已撤回 / 已下线 / 更正中；
 * 发布需双人确认；一键下线并定位引用页面。
 */

export interface ContentAdminItem {
  id: string
  type: string
  title: string
  status: string
  current_version: number | null
  reviewer: string | null
  published_at: string | null
  reference_count: number
  offline: boolean
  applicable_scope: string
}

export interface ContentAdminList {
  items: ContentAdminItem[]
  stats: Record<string, number>
  total: number
  page: number
  page_size: number
}

export interface ReviewRecordView {
  id: string
  decision: string
  review_scope: string | null
  comment: string | null
  reviewer_id: string | null
  reviewer_name: string | null
  reviewed_at: string
}

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
  versions: { version: number; script: string; subtitle_text: string; asset_key: string | null; published_at: string | null; is_current: boolean }[]
  review_records: ReviewRecordView[]
  disclaimer: string
}

export interface ContentFilters {
  type?: string
  status?: string
  scope?: string
  reviewer?: string
  page?: number
  page_size?: number
}

/** 内容列表（筛选 + 状态统计 + 分页） */
export function listContentsAdmin(filters: ContentFilters = {}): Promise<ContentAdminList> {
  return request<ContentAdminList>({ url: '/admin/contents', data: { ...filters } })
}

/** 内容详情 */
export function getContentDetailAdmin(id: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}` })
}

/** 创建草稿 */
export function createDraft(input: {
  type: string
  title: string
  applicable_scope?: string
  not_applicable?: string
  script?: string
  subtitle_text?: string
}): Promise<ContentDetail> {
  return request<ContentDetail>({ url: '/admin/contents', method: 'POST', data: { ...input } })
}

/** 编辑草稿 */
export function updateDraft(id: string, input: Record<string, unknown>): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}`, method: 'PATCH', data: { ...input } })
}

/** 提交审核 */
export function submitForReview(id: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}/submit`, method: 'POST' })
}

/** 审核通过（记录审核人与范围） */
export function approveContent(id: string, input: { review_scope?: string; comment?: string }): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}/approve`, method: 'POST', data: { ...input } })
}

/** 退回修改（记录意见） */
export function rejectContent(id: string, comment: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}/reject`, method: 'POST', data: { comment } })
}

/** 发布（需双人确认） */
export function publishContent(id: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}/publish`, method: 'POST' })
}

/** 一键下线（返回引用定位） */
export function takeOffline(id: string, reason?: string): Promise<unknown> {
  return request({ url: `/admin/contents/${encodeURIComponent(id)}/take-offline`, method: 'POST', data: { reason } })
}

/** 撤回 */
export function withdrawContent(id: string, reason?: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}/withdraw`, method: 'POST', data: { reason } })
}

/** 标记更正 */
export function markCorrecting(id: string, reason?: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}/mark-correcting`, method: 'POST', data: { reason } })
}

/** 提交新版本（更正中 → 待医学审核） */
export function resubmitContent(id: string): Promise<ContentDetail> {
  return request<ContentDetail>({ url: `/admin/contents/${encodeURIComponent(id)}/resubmit`, method: 'POST' })
}

/** 批量下线（需双人确认） */
export function batchTakeOffline(ids: string[], reason?: string): Promise<unknown> {
  return request({ url: '/admin/contents/batch-take-offline', method: 'POST', data: { ids, reason } })
}
