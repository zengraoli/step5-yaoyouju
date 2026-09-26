import { apiErrorData, request } from './request'

/**
 * 一页分析（对应 server analyses.controller.ts）
 * POST /analyses、GET /analyses/task/{taskId}
 *
 * 说明：server 目前没有「取某病程最新一次分析」的接口（只有按 id 查询），
 * 因此首页（A14）的摘要卡片用 GET /episodes/{id} 的病程事件组合展示，
 * 本模块只负责「生成一页分析」入口与任务状态查询。
 *
 * 产品红线：POST /analyses 命中红旗（high）时服务端返回 40911 / 40910，
 * 响应体 data 即就医提示内容（不创建分析任务）；前端据此跳转就医提示页（A03），
 * 不被登录、付费、上传或长问卷阻断。
 */
export interface CreateAnalysisInput {
  episode_id: string
  symptom_change?: string
  report_text?: string
  question?: string
}

/** 提交结果：排队中（等 Worker 消费）或开关关闭时的回退结果 */
export type CreateAnalysisResult =
  | { status: 'queued'; task_id: string; safety_notice: unknown }
  | { status: 'fallback'; fallback: unknown; safety_notice: unknown }

export type AnalysisTaskStatus = 'queued' | 'completed' | 'failed'

export interface AnalysisTaskView {
  status: AnalysisTaskStatus
  task_id: string
  /** queued 时的重试次数 */
  attempts?: number
  /** completed 时的一页分析详情 */
  analysis?: unknown
  /** failed 时的原因与回退内容 */
  reason?: string
  fallback?: unknown
}

/** 命中的安全规则（来自 409 响应 data.matched） */
export interface MatchedSafetyRule {
  rule_code: string
  label: string
  severity: string
  action: string
  advice: string
  excerpt: string
}

/** 就医提示内容（POST /analyses 命中红旗时 40910/40911 响应体 data） */
export interface SafetyNoticeData {
  title: string
  headline: string
  body: string
  matched: MatchedSafetyRule[]
  actions: { type: string; label: string }[]
  bring_list: string[]
  footer_note: string
  rule_set_version: string
}

/** 从 reject 的错误里取就医提示内容（命中红旗时存在，否则返回 null） */
export function safetyNoticeFromError(error: unknown): SafetyNoticeData | null {
  const data = apiErrorData(error)
  if (!data || typeof data !== 'object') return null
  const notice = data as Partial<SafetyNoticeData>
  if (!Array.isArray(notice.matched)) return null
  return notice as SafetyNoticeData
}

/** 生成一页分析：命中红旗时不建任务并返回就医提示（code 非 0，reject 中文说明） */
export function createAnalysis(input: CreateAnalysisInput): Promise<CreateAnalysisResult> {
  return request<CreateAnalysisResult>({ url: '/analyses', method: 'POST', data: { ...input } })
}

/** 查询分析任务状态（排队中 / 完成 / 失败回退） */
export function getAnalysisTask(taskId: string): Promise<AnalysisTaskView> {
  return request<AnalysisTaskView>({
    url: `/analyses/task/${encodeURIComponent(taskId)}`,
  })
}
