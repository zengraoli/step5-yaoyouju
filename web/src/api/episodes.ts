import { request } from './request'

/**
 * 病程与病程事件（对应 server episodes.controller.ts）
 */

export interface SymptomLogView {
  id: string
  care_event_id: string
  date: string
  sit_minutes: number | null
  sit_minutes_display: string
  planned_activity_done: string
  sleep_impact: number | null
  sleep_impact_display: string
  top_worry: string
  leg_change: string
}

export interface CareEventView {
  id: string
  episode_id: string
  event_type: string
  occurred_at: string
  reported_at: string
  source_type: string
  raw_text: string | null
  verify_status: string
  symptom_log: SymptomLogView | null
  report: { id: string; report_date: string | null; extracted_terms: unknown } | null
}

export interface EpisodeListItem {
  id: string
  title: string
  onset_date: string | null
  onset_certainty: string
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
  events: CareEventView[]
}

export interface TodayStatus {
  date: string
  logged: boolean
  log: SymptomLogView | null
}

export function listEpisodes(): Promise<EpisodeListItem[]> {
  return request<EpisodeListItem[]>({ url: '/episodes' })
}

export function getEpisode(episodeId: string): Promise<EpisodeDetail> {
  return request<EpisodeDetail>({ url: `/episodes/${encodeURIComponent(episodeId)}` })
}

export function getTodayStatus(episodeId: string): Promise<TodayStatus> {
  return request<TodayStatus>({ url: `/episodes/${encodeURIComponent(episodeId)}/today` })
}

/** 内联确认：把病程事件核实状态改为「已确认」 */
export function confirmEvent(episodeId: string, eventId: string): Promise<CareEventView> {
  return request<CareEventView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/events/${encodeURIComponent(eventId)}`,
    method: 'PATCH',
    data: { verify_status: '已确认' },
  })
}

export interface CreateEventInput {
  event_type: string
  occurred_at: string
  source_type: string
  raw_text?: string | null
  verify_status?: string
}

/** 新增病程事件（未回答的问题不默认阴性，一律「尚未确认」） */
export function addCareEvent(episodeId: string, input: CreateEventInput): Promise<CareEventView> {
  return request<CareEventView>({
    url: `/episodes/${encodeURIComponent(episodeId)}/events`,
    method: 'POST',
    data: { ...input },
  })
}

/** 病程时间线（服务端按北京日期分组） */
export function getEpisodeTimeline(
  episodeId: string,
): Promise<{ date: string; events: CareEventView[] }[]> {
  return request<{ date: string; events: CareEventView[] }[]>({
    url: `/episodes/${encodeURIComponent(episodeId)}/timeline`,
  })
}

/** 记录今天（允许跳过；缺失字段记为「尚未确认」，不复用昨日答案） */
export function logToday(
  episodeId: string,
  input: {
    date?: string
    sit_minutes?: number | null
    planned_activity_done?: string | null
    sleep_impact?: number | null
    top_worry?: string | null
    leg_change?: string | null
    skipped?: boolean
  },
): Promise<unknown> {
  return request({
    url: `/episodes/${encodeURIComponent(episodeId)}/today-logs`,
    method: 'POST',
    data: { ...input },
  })
}
