import { request } from './request'

/** 结构化核对：来源 / 时间 / 核实状态 / 术语 */
export interface StructuredItem {
  care_event_id: string
  event_type: string
  source_type: string
  occurred_at: string
  reported_at: string
  verify_status: string
  needs_confirm: boolean
  raw_text: string | null
  report: { id: string; report_date: string | null; extracted_terms: unknown } | null
}

export interface StructuredSummary {
  total: number
  confirmed: number
  unconfirmed: number
  conflict: number
}

export function getStructured(
  episodeId: string,
): Promise<{ items: StructuredItem[]; summary: StructuredSummary }> {
  return request<{ items: StructuredItem[]; summary: StructuredSummary }>({
    url: `/episodes/${encodeURIComponent(episodeId)}/structured`,
  })
}

/** 录入报告（粘贴文字为主） */
export function createReport(input: {
  episode_id: string
  report_date?: string | null
  raw_text: string
  source_type?: string
  verify_status?: string
}): Promise<unknown> {
  return request({ url: '/reports', method: 'POST', data: { ...input } })
}
