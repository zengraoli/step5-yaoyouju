import { request } from './request'

/**
 * 报告录入与结构化核对（对应 server reports.controller.ts）
 * 主路径是粘贴文字；拍照提取为模拟 OCR（受「拍照提取」功能开关控制）。
 */

export interface CreateReportInput {
  episode_id: string
  report_date?: string | null
  raw_text: string
  source_type?: string
  verify_status?: string
}

/** 抽取出的术语及其在原文中的位置 */
export interface ExtractedTerm {
  term: string
  meaning: string
  start: number
  end: number
}

export interface ReportView {
  id: string
  care_event_id: string
  episode_id: string
  report_date: string | null
  raw_text: string
  extracted_terms: ExtractedTerm[]
  source_type: string
  verify_status: string
  occurred_at: string
}

export interface StructuredItem {
  care_event_id: string
  event_type: string
  source_type: string
  occurred_at: string
  reported_at: string
  verify_status: string
  needs_confirm: boolean
  raw_text: string | null
  report: { id: string; report_date: string | null; extracted_terms: ExtractedTerm[] } | null
}

export interface StructuredSummary {
  total: number
  confirmed: number
  unconfirmed: number
  conflict: number
}

/** 录入报告（粘贴文字） */
export function createReport(input: CreateReportInput): Promise<ReportView> {
  return request<ReportView>({ url: '/reports', method: 'POST', data: { ...input } })
}

/** 拍照提取（模拟 OCR）：开关关闭时服务端返回 50300 + 中文说明 */
export function ocrReport(): Promise<{ text: string; simulated: boolean; message: string }> {
  return request<{ text: string; simulated: boolean; message: string }>({
    url: '/reports/ocr',
    method: 'POST',
  })
}

/** 某病程的报告列表 */
export function listReports(episodeId: string): Promise<ReportView[]> {
  return request<ReportView[]>({ url: `/episodes/${episodeId}/reports` })
}

/** 结构化核对：来源 / 时间 / 核实状态 / 术语 */
export function getStructured(
  episodeId: string,
): Promise<{ items: StructuredItem[]; summary: StructuredSummary }> {
  return request<{ items: StructuredItem[]; summary: StructuredSummary }>({
    url: `/episodes/${episodeId}/structured`,
  })
}
