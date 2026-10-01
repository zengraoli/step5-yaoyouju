import { describe, expect, it } from 'vitest'
import { beijingDate, relativeDayLabel, weeksSince } from '@/utils/date'

/** 时间展示按北京时间（UTC+8）：UTC 晚 8 小时的记录不能差一天 */
describe('时间工具（北京时间展示）', () => {
  it('UTC 转北京时间日期', () => {
    expect(beijingDate('2026-09-19T16:30:00.000Z')).toBe('2026-09-20')
    expect(beijingDate('2026-09-20T15:30:00.000Z')).toBe('2026-09-20')
    expect(beijingDate('')).toBe('')
  })

  it('相对日期标签', () => {
    const today = beijingDate()
    expect(relativeDayLabel(today)).toBe('今天')
    expect(relativeDayLabel('')).toBe('')
    expect(relativeDayLabel('2020-01-01')).toBe('2020-01-01')
  })

  it('起病周数至少 1 周', () => {
    expect(weeksSince(new Date().toISOString())).toBe(1)
    expect(weeksSince('2026-08-01T00:00:00.000Z')).toBeGreaterThanOrEqual(1)
  })
})
