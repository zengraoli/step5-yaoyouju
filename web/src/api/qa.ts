import { request } from './request'

/**
 * 问与解释（对应 server qa.controller.ts）
 * 基于当前分析上下文回答追问并引用来源；越界问题明确不答并可加入复诊问题。
 */

/** 一条引用（证据文档 / 病程事件 / 一页分析） */
export interface QaCitation {
  kind: 'evidence_doc' | 'care_event' | 'analysis'
  evidence_doc_id?: string
  care_event_id?: string
  analysis_id?: string
  /** 来源说明（服务端 source_label：证据文档标题 / 病程事件来源 / 分析版本） */
  source_label?: string
  /** 兼容旧字段名 */
  label?: string
  statement?: string
}

export interface QaMessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: QaCitation[]
  refused: boolean
  followup_question: string | null
  /** 越界拒答时可一键加入复诊问题 */
  add_to_followup: boolean
  created_at: string
}

export interface QaSessionListItem {
  id: string
  episode_id: string | null
  created_at: string
  message_count: number
  last_message: { role: string; content: string; created_at: string } | null
}

export interface QaSessionDetail {
  id: string
  episode_id: string | null
  created_at: string
  messages: QaMessageView[]
}

export interface AskResult {
  session_id: string
  user_message_id: string
  message_id: string
  reply: string
  refused: boolean
  followup_question: string | null
  add_to_followup: boolean
  close_round: boolean
  citations: QaCitation[]
  disclaimer: string
  context: { episode_id: string | null; analysis_id: string | null; analysis_version: number | null }
}

/** 创建会话（可关联当前病程） */
export function createQaSession(episodeId?: string): Promise<QaSessionDetail> {
  return request<QaSessionDetail>({
    url: '/qa/sessions',
    method: 'POST',
    data: episodeId ? { episode_id: episodeId } : {},
  })
}

/** 历史会话列表 */
export function listQaSessions(): Promise<QaSessionListItem[]> {
  return request<QaSessionListItem[]>({ url: '/qa/sessions' })
}

/** 会话详情与全部消息 */
export function getQaSession(sessionId: string): Promise<QaSessionDetail> {
  return request<QaSessionDetail>({ url: `/qa/sessions/${encodeURIComponent(sessionId)}` })
}

/** 提问：基于当前上下文回答；越界明确不答；红旗命中返回 40910/40911 */
export function askQuestion(sessionId: string, content: string): Promise<AskResult> {
  return request<AskResult>({
    url: `/qa/sessions/${encodeURIComponent(sessionId)}/messages`,
    method: 'POST',
    data: { content },
  })
}

/** 结束本轮（返回小结） */
export function closeQaSession(sessionId: string): Promise<unknown> {
  return request({ url: `/qa/sessions/${encodeURIComponent(sessionId)}/close`, method: 'POST' })
}
