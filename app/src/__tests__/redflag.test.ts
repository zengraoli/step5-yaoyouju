import { describe, expect, it } from 'vitest'
import { hasHighSeverity, matchTextsOfKeys, signalsOfKeys } from '@/utils/redflag'

/** A02 红旗选项：与服务端 RF-xx 规则对应，命中 high 级要停止个性化分析 */
describe('A02 红旗选项', () => {
  it('三个 high 级选项都会停止个性化分析', () => {
    expect(hasHighSeverity(['bowel'])).toBe(true)
    expect(hasHighSeverity(['saddle'])).toBe(true)
    expect(hasHighSeverity(['legs'])).toBe(true)
  })

  it('发热是中危：提示就医但不停止个性化分析', () => {
    expect(hasHighSeverity(['fever'])).toBe(false)
  })

  it('未选 / 选「以上都没有」不触发', () => {
    expect(hasHighSeverity([])).toBe(false)
    expect(hasHighSeverity(['none'])).toBe(false)
  })

  it('信号名与触发文本和服务端规则一致', () => {
    expect(signalsOfKeys(['saddle'])).toEqual(['会阴部麻木'])
    expect(matchTextsOfKeys(['bowel'])).toEqual(['大小便控制变化'])
    expect(matchTextsOfKeys(['fever'])).toEqual(['腰痛伴发热'])
  })
})
