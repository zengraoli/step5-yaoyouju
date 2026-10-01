import { request } from './request'

/** 就医提示（公开接口，无需登录；R03：不被登录阻断） */
export interface EmergencyNotice {
  title: string
  headline: string
  body: string
  offline_note: string
  actions: { type: string; label: string }[]
  bring_list: string[]
  summary_action: { label: string }
  footer_note: string
}

export function getEmergencyNotice(signals?: string[], stop = false): Promise<EmergencyNotice> {
  const q = new URLSearchParams()
  if (signals && signals.length > 0) q.set('signals', signals.join('、'))
  if (stop) q.set('stop', '1')
  const qs = q.toString()
  return request<EmergencyNotice>({ url: `/safety/emergency-notice${qs ? `?${qs}` : ''}`, auth: false })
}

/** 命中规则（就医提示内容，与 /episodes/{id}/events 的 safety_notice 同构） */
export interface SafetyNotice {
  title: string
  headline: string
  body: string
  matched: {
    rule_code: string
    label: string
    severity: string
    action: string
    advice: string
    excerpt: string
  }[]
  actions: { type: string; label: string }[]
  bring_list: string[]
  footer_note: string
  rule_set_version: string
}

export interface SafetyCheckResult {
  safety_flag: 'none' | 'seek_care' | 'stop_personal'
  notice: SafetyNotice | null
}

/**
 * 提交前的红旗自检（与建立病程 / 记录今天走同一套规则）。
 * 演示实现：不单独提供校验接口，这里复用「记录今天」的返回：
 * 命中时服务端会在 200 响应里附带 safety_notice。
 */
export async function checkRedFlags(input: {
  symptom_change: string
  title?: string
}): Promise<SafetyCheckResult> {
  // 建立病程式自检通过「记录今天」不可行（还没有病程），
  // 因此这里直接用本地规则引擎做一次预检，最终以服务端为准。
  const { RED_FLAG_LOCAL } = await import('@/utils/safety')
  const hit = RED_FLAG_LOCAL.find((r) => r.pattern.test(input.symptom_change + (input.title ?? '')))
  if (!hit) return { safety_flag: 'none', notice: null }
  return {
    safety_flag: 'stop_personal',
    notice: {
      title: '需要及时寻求专业帮助',
      headline: '建议尽快就医',
      body: `你的填写包含需要尽快就医的信号：${hit.label}。`,
      matched: [
        {
          rule_code: hit.code,
          label: hit.label,
          severity: 'high',
          action: '停止个性化分析',
          advice: hit.advice,
          excerpt: input.symptom_change.slice(0, 40),
        },
      ],
      actions: [
        { type: 'call', label: '拨打 120 / 前往急诊' },
        { type: 'hospital', label: '查找附近医院' },
      ],
      bring_list: ['已录入的检查报告原文', '症状开始时间与最近变化记录'],
      footer_note: '此提示由临床审定规则触发，不是诊断结论；请以医生的评估为准。',
      rule_set_version: 'safety-rules-v2.0',
    },
  }
}
