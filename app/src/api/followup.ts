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
