import { request } from './request'

/**
 * 问与解释（对应 server qa.controller.ts，App A09 / Web W04）
 * 基于当前分析上下文回答追问并引用来源；越界问题明确不答并可加入复诊问题。
 */

/** 一条引用（证据文档 / 病程事件 / 一页分析） */
export interface QaCitation {
  kind: 'evidence_doc' | 'care_event' | 'analysis'
  evidence_doc_id?: string
  care_event_id?: string
  analysis_id?: string
  /** 来源说明（证据文档标题 / 病程事件来源 / 分析版本） */
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
  /** 用户消息 ID（落库后返回，供本地追加展示） */
  user_message_id: string
  /** 助手消息 ID */
  message_id: string
  reply: string
  refused: boolean
  followup_question: string | null
  add_to_followup: boolean
  /** 反复求保证时结束本轮 */
  close_round: boolean
  citations: QaCitation[]
  disclaimer: string
  context: {
    episode_id: string | null
    analysis_id: string | null
    analysis_version: number | null
  }
}

export interface QaCloseResult {
  session_id: string
  episode_id: string | null
  closed: boolean
  closed_at: string
  round_summary: {
    question_count: number
    answer_count: number
    refused_count: number
    followup_questions: string[]
    citation_count: number
    summary_text: string
  }
  disclaimer: string
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

/** 提问：基于当前上下文回答；越界明确不答；红旗命中返回 40910/40911 就医提示 */
export function askQuestion(sessionId: string, content: string): Promise<AskResult> {
  return request<AskResult>({
    url: `/qa/sessions/${encodeURIComponent(sessionId)}/messages`,
    method: 'POST',
    data: { content },
  })
}

/** 结束本轮（返回小结：问题数 / 拒答数 / 复诊问题） */
export function closeQaSession(sessionId: string): Promise<QaCloseResult> {
  return request<QaCloseResult>({
    url: `/qa/sessions/${encodeURIComponent(sessionId)}/close`,
    method: 'POST',
  })
}
