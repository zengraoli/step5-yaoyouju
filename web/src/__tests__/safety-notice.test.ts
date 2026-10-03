import { describe, expect, it } from 'vitest'
import { RED_FLAG_LOCAL } from '@/utils/safety'
import { FALLBACK_NOTICE_BODY } from '@/views/emergency/noticeFallback'

/**
 * 第七轮验收反馈：本地红旗预检与服务端规则同源；
 * 就医提示兜底文案不能声称用户描述 / 选择了内容（用户可能只是直接打开本页）。
 */
describe('前端红旗预检', () => {
  it('三条规则覆盖会阴麻木 / 双腿无力 / 大小便控制', () => {
    expect(RED_FLAG_LOCAL.map((r) => r.code)).toEqual(['RF-01', 'RF-02', 'RF-03', 'RF-04'])
  })

  it('命中会阴部麻木', () => {
    const hit = RED_FLAG_LOCAL.find((r) => r.pattern.test('这两天会阴部麻木，伴大小便控制变化'))
    expect(hit?.code).toBe('RF-01')
  })

  it('普通腰腿痛不误判', () => {
    const hit = RED_FLAG_LOCAL.find((r) => r.pattern.test('久坐后腰痛，起来走两步能缓解'))
    expect(hit).toBeUndefined()
  })

  it('发热选项的本地预检覆盖三种情况（不只「伴发热」）', () => {
    // A02 的发热项覆盖发热 / 夜间痛 / 体重下降，本地预检也要能命中夜间痛与体重下降说法
    const fever = RED_FLAG_LOCAL.find((r) => r.code === 'RF-04')
    expect(fever).toBeDefined()
    expect(fever!.pattern.test('夜里疼得睡不着，只能坐着到天亮')).toBe(true)
    expect(fever!.pattern.test('两个月瘦了12斤，没刻意减肥')).toBe(true)
  })
})

describe('就医提示兜底文案', () => {
  it('不声称用户描述或选择了内容', () => {
    expect(FALLBACK_NOTICE_BODY).not.toContain('你刚才选择了')
    expect(FALLBACK_NOTICE_BODY).not.toContain('你描述的内容')
    expect(FALLBACK_NOTICE_BODY).not.toContain('本轮不会生成个性化分析')
  })

  it('仍然说明产品边界', () => {
    expect(FALLBACK_NOTICE_BODY).toContain('请尽快就医')
    expect(FALLBACK_NOTICE_BODY).toContain('不作诊断')
  })
})
