/**
 * 前端红旗预检（与服务端 safety.rules.ts 同源的最小集合）。
 * 只用于「提交前即时提示」，最终判定一律以服务端为准。
 */
export interface LocalRedFlagRule {
  code: string
  label: string
  advice: string
  pattern: RegExp
}

export const RED_FLAG_LOCAL: LocalRedFlagRule[] = [
  {
    code: 'RF-01',
    label: '会阴部麻木',
    advice: '会阴部（或鞍区）麻木需要尽快由医生评估，请前往医院就诊。',
    pattern: /(会阴[部区处]?[麻木发麻]|鞍区[麻木]|马鞍区[麻木]|屁股[麻木])/,
  },
  {
    code: 'RF-02',
    label: '双腿进行性无力',
    advice: '下肢无力如果在加重，需要尽快由医生评估，请前往医院就诊。',
    pattern: /(双腿[，,]?(进行性|越来越)?[无力没劲]|两条腿[，,]?(越来越)?[无力没劲]|腿越[来越]?[越]?没[有力])/,
  },
  {
    code: 'RF-03',
    label: '大小便控制变化',
    advice: '大小便控制出现变化需要尽快由医生评估，请立即就医。',
    pattern: /(大小便[失禁控管]|大小变失禁|大便憋不住|尿不出|解不出|排尿困难|尿潴留|便失禁)/,
  },
]
