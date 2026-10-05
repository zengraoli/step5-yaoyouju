/**
 * 第九轮（F9）主持全新独立新编 100 条 —— 纯函数核对（无需启动 server）。
 * 60 应触发命中 / 40 不应触发零误判。用法：npx tsx scripts/round9-cases.ts
 */
import { RED_FLAG_RULES, matchesRedFlagRule } from '../src/modules/safety/safety.rules'
// @ts-ignore - .mjs 用例数组
import { ROUND9_TRIGGER, ROUND9_NOT } from './round9-data.mjs'

function flagged(text: string): string[] {
  return RED_FLAG_RULES.filter((r) => matchesRedFlagRule(r, text)).map((r) => r.code)
}

const groups: { name: string; items: string[]; want: 'hit' | 'miss' }[] = [
  { name: '应触发(60)', items: ROUND9_TRIGGER as string[], want: 'hit' },
  { name: '不应触发(40)', items: ROUND9_NOT as string[], want: 'miss' },
]

let totalFail = 0
for (const g of groups) {
  const bad: string[] = []
  g.items.forEach((t, i) => {
    const f = flagged(t)
    if (g.want === 'hit' && f.length === 0) bad.push(`[漏判] #${i + 1}: ${t}`)
    if (g.want === 'miss' && f.length > 0) bad.push(`[误判→${f.join(',')}] #${i + 1}: ${t}`)
  })
  const ok = g.items.length - bad.length
  console.log(`${g.name}：${ok}/${g.items.length}${bad.length ? '  ✗' : '  ✓'}`)
  for (const b of bad) console.log('   ' + b)
  totalFail += bad.length
}
console.log(totalFail === 0 ? '\n全部通过' : `\n共 ${totalFail} 条不达标`)
process.exitCode = totalFail === 0 ? 0 : 1
