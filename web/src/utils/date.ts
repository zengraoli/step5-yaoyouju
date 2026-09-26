/** 时间工具：存储与传输用 UTC ISO8601，界面按北京时间（UTC+8）显示 */

/** UTC ISO8601 → 北京时间日期 YYYY-MM-DD；不传参数返回今天 */
export function beijingDate(iso?: string): string {
  const time = iso ? new Date(iso).getTime() : Date.now()
  if (Number.isNaN(time)) return ''
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 相对日期标签：今天 / 昨天 / N 天前 / 具体日期 */
export function relativeDayLabel(date: string): string {
  if (!date) return ''
  const today = beijingDate()
  if (date === today) return '今天'
  const yesterday = new Date(`${today}T00:00:00.000+08:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  const yd = new Date(yesterday.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  if (date === yd) return '昨天'
  const diff = Math.round(
    (new Date(`${today}T00:00:00.000+08:00`).getTime() - new Date(`${date}T00:00:00.000+08:00`).getTime()) /
      (24 * 3600 * 1000),
  )
  if (diff > 0 && diff < 30) return `${diff} 天前`
  return date
}

/** 起病至今周数（至少 1 周） */
export function weeksSince(iso: string): number {
  const start = new Date(iso).getTime()
  if (Number.isNaN(start)) return 1
  const weeks = Math.floor((Date.now() - start) / (7 * 24 * 3600 * 1000))
  return Math.max(1, weeks + 1)
}
