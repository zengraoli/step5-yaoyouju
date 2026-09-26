import { request } from './request'

/**
 * 复诊摘要（对应 server followup.controller.ts）
 * 固定六段；区分自述 / 报告原文 / 医生记录；未核实项保留。
 */

export interface FollowupItem {
  text: string
  /** 自述 / 报告原文 / 医生记录 */
  source: string
  verify_status?: string
  care_event_id?: string
  from?: string
}

export interface FollowupSection {
  key: string
  title: string
  items: FollowupItem[]
}

export interface FollowupContentView {
  sections: FollowupSection[]
  generated_at: string | null
  corrected?: boolean
  corrected_at?: string
  disclaimer: string
}

export interface FollowupSummaryView {
  id: string
  episode_id: string
  content: FollowupContentView
  generated_at: string | null
  corrected: boolean
  exported: boolean
  export_format: string | null
  exported_at: string | null
  disclaimer: string
}

export interface FollowupExportView {
  id: string
  episode_id: string
  format: '文本' | 'PDF' | '图片'
  export_format: '文本' | 'PDF' | '图片'
  exported_at: string
  text: string
  browser_print: boolean
  note: string
}

/** 问题清单段的 key */
export const QUESTIONS_SECTION_KEY = 'questions'

/** 最新一份复诊摘要（没有生成过时 reject 中文说明） */
export function getLatestFollowup(episodeId: string): Promise<FollowupSummaryView> {
  return request<FollowupSummaryView>({ url: `/episodes/${encodeURIComponent(episodeId)}/followup` })
}

/** 生成复诊摘要（固定六段；未核实项保留并标记） */
export function generateFollowup(episodeId: string): Promise<FollowupSummaryView> {
  return request<FollowupSummaryView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/followup/generate`,
    method: 'POST',
  })
}

/** 预览后纠正（编辑各段文字、增删问题、调整顺序） */
export function correctFollowup(
  episodeId: string,
  summaryId: string,
  input: { sections: FollowupSection[] },
): Promise<FollowupSummaryView> {
  return request<FollowupSummaryView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/followup/${encodeURIComponent(summaryId)}`,
    method: 'PUT',
    data: { ...input },
  })
}

/** 导出：文本返回纯文本；PDF / 图片由浏览器打印生成 */
export function exportFollowup(
  episodeId: string,
  summaryId: string,
  format: '文本' | 'PDF' | '图片',
): Promise<FollowupExportView> {
  return request<FollowupExportView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/followup/${encodeURIComponent(summaryId)}/export`,
    method: 'POST',
    data: { format },
  })
}
