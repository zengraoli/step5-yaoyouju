import { request } from './request'

/**
 * 复诊摘要（对应 server followup.controller.ts）
 * GET /episodes/{id}/followup —— 最新一份摘要（固定六段 + 生成时间 + 是否已导出）。
 * 首页（A14）用它统计「待确认问题」数量；没有生成过时服务端返回 404（调用方需容错）。
 */

export interface FollowupItem {
  text: string
  /** 自述 / 报告原文 / 医生记录 */
  source: string
  /** 病程事实的核实状态；问题清单不适用 */
  verify_status?: string
  care_event_id?: string
  /** 问题清单来源：用户加入 / 分析整理 */
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

/** 问题清单段的 key（该段条目是「问题」，不标核实状态） */
export const QUESTIONS_SECTION_KEY = 'questions'

/** 最新一份复诊摘要（没有生成过时 reject 中文说明） */
export function getLatestFollowup(episodeId: string): Promise<FollowupSummaryView> {
  return request<FollowupSummaryView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/followup`,
  })
}

/** 导出的复诊摘要（文本带头部与水印脚注；PDF / 图片由浏览器打印生成） */
export interface FollowupExportView {
  id: string
  episode_id: string
  format: '文本' | 'PDF' | '图片'
  export_format: '文本' | 'PDF' | '图片'
  exported_at: string
  /** 文本：完整纯文本；PDF / 图片：浏览器打印说明文本 */
  text: string
  browser_print: boolean
  note: string
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

/** 导出：文本返回纯文本；PDF / 图片标记为浏览器打印生成 */
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
