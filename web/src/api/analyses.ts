import { request } from '@/api/request'


/** 一页分析（五段固定结构；每条解释都带来源） */
export interface AnalysisView {
  id: string
  episode_id: string
  version: number
  model_release_id: string | null
  safety_flag: string
  created_at: string
  sections: {
    known: { text: string; source: string; care_event_id?: string }[]
    explain: { text: string; citations: { evidence_doc_id: string; doc_title: string; statement: string; supported: boolean }[] }[]
    unknown: string[]
    next: { text: string; type: string }[]
    videos: { content_item_id: string; title: string; reason: string }[]
    meta: { model_release: string; generated_at: string; version: number; disclaimer: string }
  }
  retrieval_snapshot: Record<string, unknown> | null
  disclaimer: string
}

/** 某病程最新一页分析（没有则返回 null） */
export function getLatestAnalysis(episodeId: string): Promise<AnalysisView | null> {
  return request<AnalysisView | null>({ url: `/analyses/by-episode/${encodeURIComponent(episodeId)}` })
}

/** 生成一页分析：命中红旗时不建任务并返回就医提示；通过返回 202 任务 ID */
export function createAnalysis(input: {
  episode_id: string
  symptom_change?: string
  report_text?: string
  question?: string
}): Promise<
  | { status: 'queued'; task_id: string; safety_notice: unknown }
  | { status: 'fallback'; fallback: unknown; safety_notice: unknown }
> {
  return request({
    url: '/analyses',
    method: 'POST',
    data: { ...input },
  })
}

/** 一页分析详情（五段结构 + 每条解释的来源） */
export function getAnalysis(analysisId: string): Promise<AnalysisView> {
  return request<AnalysisView>({ url: `/analyses/${encodeURIComponent(analysisId)}` })
}

export type AnalysisTaskStatus = 'queued' | 'completed' | 'failed'

export interface AnalysisTaskView {
  status: AnalysisTaskStatus
  task_id: string
  attempts?: number
  analysis?: unknown
  reason?: string
  fallback?: unknown
}

/** 查询分析任务状态（排队中 / 完成 / 失败回退） */
export function getAnalysisTask(taskId: string): Promise<AnalysisTaskView> {
  return request<AnalysisTaskView>({ url: `/analyses/task/${encodeURIComponent(taskId)}` })
}
