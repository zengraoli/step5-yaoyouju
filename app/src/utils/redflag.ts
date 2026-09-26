/**
 * 红旗选项（A02 关键变化确认 → A03 就医提示）
 *
 * 与 server 安全规则集（server/src/modules/safety/safety.rules.ts，RF-xx）对应：
 * - label：A02 设计稿中的选项文案（用户看到的选择）
 * - signal：命中后的规范信号名（A03「你刚才选择了：…」展示，与服务端规则 label 一致）
 * - match：写入病程摘要、用于触发服务端红旗校验的文本（high 级必须能被规则匹配到）
 * - severity：high = 停止个性化分析（40911）；medium = 提示就医（40910，分析仍生成）
 *
 * 产品红线：命中红旗立即显示就医提示，不被登录、付费、上传或长问卷阻断。
 */

export type RedFlagSeverity = 'high' | 'medium'

export interface RedFlagOption {
  /** 选项键（页面内部使用） */
  key: string
  /** A02 选项文案（按设计稿） */
  label: string
  /** 规范信号名（A03 展示） */
  signal: string
  /** 触发服务端红旗规则的文本 */
  match: string
  severity: RedFlagSeverity
}

/** A02 第 2 题中的四个症状选项（都需要医生及时评估） */
export const RED_FLAG_OPTIONS: RedFlagOption[] = [
  {
    key: 'bowel',
    label: '大小便控制异常',
    signal: '大小便控制变化',
    match: '大小便控制变化',
    severity: 'high',
  },
  {
    key: 'saddle',
    label: '会阴区或鞍区麻木',
    signal: '会阴部麻木',
    match: '会阴部麻木',
    severity: 'high',
  },
  {
    key: 'legs',
    label: '双腿进行性无力',
    signal: '双腿进行性无力',
    match: '双腿进行性无力',
    severity: 'high',
  },
  {
    key: 'fever',
    label: '发热、夜间痛持续不缓解或体重明显下降',
    signal: '伴发热',
    match: '腰痛伴发热',
    severity: 'medium',
  },
]

/** 第 2 题中的两个非红旗选项（「以上都没有」与其它选项互斥） */
export const RED_FLAG_NONE_KEY = 'none'
export const RED_FLAG_UNSURE_KEY = 'unsure'

/** 已选选项键 → 规范信号名（A03 展示用） */
export function signalsOfKeys(keys: string[]): string[] {
  return RED_FLAG_OPTIONS.filter((o) => keys.includes(o.key)).map((o) => o.signal)
}

/** 已选选项键 → 触发安全规则的文本（写入病程摘要） */
export function matchTextsOfKeys(keys: string[]): string[] {
  return RED_FLAG_OPTIONS.filter((o) => keys.includes(o.key)).map((o) => o.match)
}

/** 是否命中 high 级红旗（停止个性化分析） */
export function hasHighSeverity(keys: string[]): boolean {
  return RED_FLAG_OPTIONS.some((o) => keys.includes(o.key) && o.severity === 'high')
}

/** 规范信号名 → 是否 high 级（A03 用于区分「尽快就医」与「及时就医评估」） */
export function isHighSeveritySignal(signal: string): boolean {
  return RED_FLAG_OPTIONS.some((o) => o.signal === signal && o.severity === 'high')
}
