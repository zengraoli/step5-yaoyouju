/**
 * 系统与时间工具
 * - 自定义导航栏需要的状态栏高度（设计稿按 375 宽度还原，H5 / App 通用）
 * - 时间统一按北京时间（UTC+8）展示，与 server 的 UTC ISO8601 存储对应（见 docs/brief.md 全局约定）
 */

/** 状态栏高度（px）：取不到时返回 0（桌面浏览器无状态栏） */
export function getStatusBarHeight(): number {
  try {
    const info = uni.getSystemInfoSync() as unknown as { statusBarHeight?: number }
    const height = info?.statusBarHeight
    return typeof height === 'number' && height > 0 ? Math.ceil(height) : 0
  } catch {
    return 0
  }
}

/** UTC ISO8601 → 北京时间日期 YYYY-MM-DD */
export function beijingDate(iso: string): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ''
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 今天的北京时间日期 YYYY-MM-DD */
export function beijingToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 与今天相差的天数（正数 = 未来，负数 = 过去，0 = 今天；非法日期返回 NaN） */
export function daysFromToday(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN
  const target = Date.parse(`${date}T00:00:00.000+08:00`)
  const today = Date.parse(`${beijingToday()}T00:00:00.000+08:00`)
  if (Number.isNaN(target) || Number.isNaN(today)) return Number.NaN
  return Math.round((target - today) / 86400000)
}

/** 相对日期文案：今天 / 明天 / 昨天 / N 天后 / N 天前 */
export function relativeDayLabel(date: string): string {
  const diff = daysFromToday(date)
  if (Number.isNaN(diff)) return '时间尚未确认'
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`
}

/** 两个北京时间日期相差天数（from → to，正数表示 to 更晚） */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00.000+08:00`)
  const to = Date.parse(`${toDate}T00:00:00.000+08:00`)
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN
  return Math.round((to - from) / 86400000)
}

/** 起病至今的周数（至少 1 周；起病日期缺失返回 NaN） */
export function weeksSince(onsetDate: string): number {
  const days = daysBetween(onsetDate, beijingToday())
  if (Number.isNaN(days)) return Number.NaN
  return Math.max(1, Math.ceil(days / 7))
}

/** 文本截断：压缩空白并按字数截断，超出追加省略号（用于卡片摘要，不改变原意） */
export function excerpt(text: string | null | undefined, max = 40): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 日期加上若干天 / 周 / 个月，返回 YYYY-MM-DD（按月按 30 天近似） */
export function addToDate(date: string, amount: number, unit: '天' | '周' | '个月'): string {
  const base = Date.parse(`${date}T00:00:00.000+08:00`)
  if (Number.isNaN(base)) return ''
  const days = unit === '周' ? amount * 7 : unit === '个月' ? amount * 30 : amount
  return new Date(base + days * 86400000).toISOString().slice(0, 10)
}

/** 中文数字（零~十、十一~九十九）转阿拉伯数字；无法解析返回 NaN */
const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

export function parseCountToken(token: string): number {
  const value = token.trim()
  if (!value) return Number.NaN
  if (/^\d+$/.test(value)) return Number(value)
  if (value === '十') return 10
  if (value.length === 1) return CN_DIGITS[value] ?? Number.NaN
  if (value.startsWith('十')) return 10 + (CN_DIGITS[value[1]] ?? 0)
  if (value.includes('十')) {
    const [tens, ones] = value.split('十')
    return (CN_DIGITS[tens] ?? 1) * 10 + (ones ? CN_DIGITS[ones] ?? 0 : 0)
  }
  return Number.NaN
}
