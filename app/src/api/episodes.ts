import { request } from './request'

/**
 * 病程记录（对应 server episodes.controller.ts）
 * GET /episodes、POST /episodes、GET /episodes/{id}、
 * GET /episodes/{id}/today、PATCH /episodes/{id}/events/{eventId}
 *
 * 产品红线：缺失字段一律由服务端返回「尚未确认」，前端不默认阴性 / 无；
 * 用户纠正内容时服务端会把核实状态降级，需再次确认。
 */

/** 核实状态：未回答显示「尚未确认」，不能显示「无」 */
export const VERIFY_STATUSES = ['已确认', '尚未确认', '有冲突'] as const
export type VerifyStatus = (typeof VERIFY_STATUSES)[number]

export const UNCONFIRMED: VerifyStatus = '尚未确认'

/** 事件类型 */
export const EVENT_TYPES = ['报告', '症状', '医嘱', '行动', '结局'] as const

/** 来源类型（三端一致） */
export const SOURCE_TYPES = ['自述', '报告原文', '医生记录'] as const

export interface SymptomLogView {
  id: string
  care_event_id: string
  date: string
  sit_minutes: number | null
  /** 缺失时服务端返回「尚未确认」 */
  sit_minutes_display: string
  planned_activity_done: string
  sleep_impact: number | null
  sleep_impact_display: string
  top_worry: string
  leg_change: string
}

export interface CareEventReport {
  id: string
  report_date: string | null
  extracted_terms: unknown
}

export interface CareEventView {
  id: string
  episode_id: string
  event_type: string
  /** UTC ISO8601 */
  occurred_at: string
  reported_at: string
  source_type: string
  raw_text: string | null
  verify_status: string
  symptom_log: SymptomLogView | null
  report: CareEventReport | null
}

export interface EpisodeListItem {
  id: string
  title: string
  onset_date: string | null
  onset_certainty: string
  /** 进行中 / 已结束 */
  status: string
  created_at: string
  event_count: number
}

export interface EpisodeDetail {
  id: string
  title: string
  onset_date: string | null
  onset_certainty: string
  status: string
  created_at: string
  /** 按发生时间倒序（最新在前） */
  events: CareEventView[]
}

export interface TodayStatus {
  /** 北京时间日期 YYYY-MM-DD */
  date: string
  logged: boolean
  /** 没有今天记录时为 null（不返回昨日答案） */
  log: SymptomLogView | null
}

export interface CreateEpisodeInput {
  title: string
  onset_date?: string | null
  onset_certainty?: string
}

export interface CreateEventInput {
  /** 事件类型：报告 / 症状 / 医嘱 / 行动 / 结局 */
  event_type: string
  /** 发生时间（UTC ISO8601） */
  occurred_at: string
  /** 来源类型：自述 / 报告原文 / 医生记录 */
  source_type: string
  /** 原文片段（结构化摘要） */
  raw_text?: string | null
  /** 核实状态：未确认的问题不默认阴性，一律「尚未确认」 */
  verify_status?: string
}

/** 我的病程列表 */
export function listEpisodes(): Promise<EpisodeListItem[]> {
  return request<EpisodeListItem[]>({ url: '/episodes' })
}
/** 创建病程（新用户空状态引导） */
export function createEpisode(input: CreateEpisodeInput): Promise<EpisodeDetail> {
  return request<EpisodeDetail>({ url: '/episodes', method: 'POST', data: { ...input } })
}

/** 病程详情（含病程事件） */
export function getEpisode(episodeId: string): Promise<EpisodeDetail> {
  return request<EpisodeDetail>({ url: `/episodes/${encodeURIComponent(episodeId)}` })
}

/** 今天的记录状态（没有则 logged = false，不返回昨日答案） */
export function getTodayStatus(episodeId: string): Promise<TodayStatus> {
  return request<TodayStatus>({ url: `/episodes/${encodeURIComponent(episodeId)}/today` })
}

/** 内联确认：把病程事件核实状态改为「已确认」（用户本人操作，不默认阴性） */
export function confirmEvent(episodeId: string, eventId: string): Promise<CareEventView> {
  return request<CareEventView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/events/${encodeURIComponent(eventId)}`,
    method: 'PATCH',
    data: { verify_status: '已确认' },
  })
}

/** 新增病程事件（如关键变化确认的结构化摘要；未回答的问题不默认阴性） */
export function addCareEvent(episodeId: string, input: CreateEventInput): Promise<CareEventView> {
  return request<CareEventView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/events`,
    method: 'POST',
    data: { ...input },
  })
}
