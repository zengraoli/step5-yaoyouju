import { request } from './request'

/**
 * 反馈与错误举报（对应 server feedback.controller.ts）
 * 产品红线：反馈与举报不自动进入训练或内容库。
 */

/** 帮助类型（服务端枚举） */
export type HelpType = '看懂了' | '知道下一步' | '都不好'

/** 举报分类 */
export const REPORT_CATEGORIES = ['解释与报告不符', '来源缺失', '内容出错', '其他'] as const

/** 举报严重度 */
export const REPORT_SEVERITIES = ['low', 'medium', 'high'] as const

export interface SubmitHelpInput {
  analysis_id: string
  help_type: HelpType
  unsolved_question?: string
}

export interface SubmitErrorReportInput {
  analysis_id?: string
  content_item_id?: string
  category: string
  description: string
  severity: 'low' | 'medium' | 'high'
}

export interface FeedbackItem {
  id: string
  analysis_id: string | null
  help_type: string | null
  unsolved_question: string | null
  is_error_report: number
  category: string | null
  description: string | null
  severity: string | null
  status: string
  report_meta: unknown
  created_at: string
}

/** 帮助类型反馈（看懂了 / 知道下一步 / 都不好 + 未解决的问题） */
export function submitHelpFeedback(input: SubmitHelpInput): Promise<FeedbackItem> {
  return request<FeedbackItem>({ url: '/feedback', method: 'POST', data: { ...input } })
}

/** 错误举报（自动附带分析 / 模型 / 内容 / 规则集四类版本） */
export function submitErrorReport(input: SubmitErrorReportInput): Promise<FeedbackItem> {
  return request<FeedbackItem>({ url: '/feedback/error-report', method: 'POST', data: { ...input } })
}

/** 我提交的反馈与举报 */
export function listMyFeedback(): Promise<FeedbackItem[]> {
  return request<FeedbackItem[]>({ url: '/feedback/mine' })
}
