import { request } from './request'

/**
 * 反馈与错误举报（对应 server feedback.controller.ts）
 * 产品红线：反馈与举报不自动进入训练或内容库。
 */

/** 帮助类型（服务端枚举） */
export type HelpType = '看懂了' | '知道下一步' | '都不好'

/** 帮助类型反馈 */
export function submitHelpFeedback(input: {
  analysis_id: string
  help_type: HelpType
  unsolved_question?: string
}): Promise<unknown> {
  return request({ url: '/feedback', method: 'POST', data: { ...input } })
}

/** 错误举报（自动附带分析 / 模型 / 内容 / 规则集四类版本） */
export function submitErrorReport(input: {
  analysis_id?: string
  content_item_id?: string
  category: string
  description: string
  severity: 'low' | 'medium' | 'high'
}): Promise<unknown> {
  return request({ url: '/feedback/error-report', method: 'POST', data: { ...input } })
}
