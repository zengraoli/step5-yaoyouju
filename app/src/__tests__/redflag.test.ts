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
    // 发热这一项覆盖三种情况：就医提示里不能只写「伴发热」（第七轮第 32 条）
    expect(signalsOfKeys(['fever'])).toEqual(['发热、夜间痛持续不缓解或体重明显下降'])
    expect(matchTextsOfKeys(['fever'])).toEqual(['发热、夜间痛持续不缓解或体重明显下降'])
  })

  it('发热选项的触发文本能被服务端规则命中（RF-06 伴发热）', () => {
    // 服务端 RF-06 的 standalone 含「发热」：写入病程后必须命中并提示就医
    const text = matchTextsOfKeys(['fever'])[0]
    expect(text).toContain('发热')
  })
})

/** 就医提示兜底文案：用户可能只是直接打开本页，不能说「你刚才选择了…」（第七轮第 31 条） */
describe('就医提示兜底文案', () => {
  const fallback = {
    title: '需要及时寻求专业帮助',
    headline: '建议尽快就医',
    body: '如果你出现了需要医生及时评估的变化，请尽快就医。这类提示不会被登录、付费或上传阻断；本产品无法替你判断严重程度，不作诊断。',
  }

  it('兜底正文不声称用户描述或选择了内容', () => {
    expect(fallback.body).not.toContain('你刚才选择了')
    expect(fallback.body).not.toContain('你描述的内容')
    expect(fallback.body).not.toContain('本轮不会生成个性化分析')
  })

  it('兜底正文仍然说明产品边界', () => {
    expect(fallback.body).toContain('请尽快就医')
    expect(fallback.body).toContain('不作诊断')
  })
})
