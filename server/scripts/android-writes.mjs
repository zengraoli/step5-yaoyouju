#!/usr/bin/env node
/**
 * Android 写操作逐项验收（deep link 直达各页面，真实操作后查库确认写入）。
 */
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'

const ADB = 'adb'
const PKG = 'com.yaoyouju.android'
const sh = (cmd) => execFileSync(ADB, ['shell', cmd], { encoding: 'utf8', timeout: 60000 })
const dump = () => {
  sh('uiautomator dump /sdcard/yyj-ui.xml >/dev/null 2>&1')
  const xml = execFileSync(ADB, ['shell', 'cat', '/sdcard/yyj-ui.xml'], { encoding: 'buffer', timeout: 60000 }).toString('utf8')
  const nodes = []
  const re = /<node[^>]*>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0]
    const text = /text="([^"]*)"/.exec(tag)?.[1] ?? ''
    const cls = /class="([^"]*)"/.exec(tag)?.[1]?.split('.').pop() ?? ''
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag)
    if (!b) continue
    const [, x1, y1, x2, y2] = b.map(Number)
    nodes.push({ text, isField: cls.includes('EditText'), cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2), y1 })
  }
  return nodes
}
const tapText = async (want, exact = false) => {
  sh('input keyevent 111')
  await delay(400)
  let found = dump().find((n) => n.text && (exact ? n.text === want : n.text.includes(want)))
  if (!found) {
    sh('input keyevent 111')
    await delay(700)
    found = dump().find((n) => n.text && (exact ? n.text === want : n.text.includes(want)))
  }
  if (!found) {
    console.log(`  ⚠ 未找到「${want}」`)
    return false
  }
  sh(`input tap ${found.cx} ${found.cy}`)
  return true
}
const link = async (code, wait = 4000) => {
  sh(`am start -a android.intent.action.VIEW -d "yaoyoujuapp://${code}" >/dev/null 2>&1`)
  await delay(wait)
}
let pass = 0
let fail = 0
const check = (n, c, e) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, e ?? '') } }
const dbCounts = () => {
  try { return dbCountsInner() } catch { return null }
}
const dbCountsInner = () => {
  const db = new DatabaseSync(process.env.DB_DIR ? `${process.env.DB_DIR}/app.db` : '.tmpdb/app.db', { readOnly: true })
  // 取最新注册用户的最近病程（模拟器上登录的就是这个用户）
  const user = db.prepare('SELECT id FROM users ORDER BY created_at DESC LIMIT 1').all()[0]
  const ep = user
    ? db.prepare('SELECT id FROM episode WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').all()[0]
    : undefined
  if (!ep) { db.close(); return null }
  const r = ep
    ? db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM care_event c WHERE c.episode_id=?) ev,
                  (SELECT COUNT(*) FROM symptom_log s JOIN care_event c ON c.id=s.care_event_id WHERE c.episode_id=?) lg,
                  (SELECT COUNT(*) FROM report r JOIN care_event c ON c.id=r.care_event_id WHERE c.episode_id=?) rp,
                  (SELECT COUNT(*) FROM analysis WHERE episode_id=?) an,
                  (SELECT COUNT(*) FROM followup_summary WHERE episode_id=?) fu`,
        )
        .get(ep.id, ep.id, ep.id, ep.id, ep.id)
    : null
  db.close()
  return r ?? null
}

async function main() {
  // 先建病程（A02）：底部「病程」→ 记录当前关键变化
  sh('input tap 395 1558')
  await delay(3500)
  for (let i = 0; i < 4; i += 1) {
    if (dump().some((n) => (n.text || '').includes('记录当前关键变化'))) break
    sh('input swipe 360 1300 360 700 400')
    await delay(700)
  }
  await tapText('记录当前关键变化')
  await delay(3000)
  await tapText('加重', true)
  await delay(400)
  sh('input swipe 360 1300 360 700 400')
  await delay(700)
  await tapText('左侧', true)
  await delay(400)
  for (let i = 0; i < 5; i += 1) {
    if (dump().some((n) => (n.text || '').includes('下一步'))) break
    sh('input swipe 360 1300 360 600 400')
    await delay(700)
  }
  await tapText('下一步')
  await delay(2500)
  await tapText('下一步：录入报告')
  await delay(2500)
  const before = dbCounts()
  console.log('  写入前:', JSON.stringify(before))
  check('建立病程写入 care_event', (before?.ev ?? 0) >= 1, JSON.stringify(before))

  // A05 录入报告（字段顺序：检查机构 / 报告原文 / 报告日期）
  await link('A05')
  const rfs = dump().filter((n) => n.isField).sort((a, b) => a.y1 - b.y1)
  const rf = rfs[1] ?? rfs[0]
  if (rf) sh(`input tap ${rf.cx} ${rf.cy}`)
  await delay(700)
  sh('input text "Lumbar MRI: sequence normal, mild L4/5 degeneration."')
  sh('input keyevent 111')
  await delay(400)
  sh('input tap 360 1330')
  await delay(4000)
  const afterReport = dbCounts()
  check('录入报告后 report 表写入', (afterReport?.rp ?? 0) > (before?.rp ?? 0), JSON.stringify(afterReport))

  // A07 生成一页分析（首页入口）
  await link('A07', 5000)
  const gen = dump().find((n) => n.text.includes('生成一页分析'))
  if (gen) sh(`input tap ${gen.cx} ${gen.cy}`)
  await delay(14000)
  const afterAnalysis = dbCounts()
  check('生成分析后 analysis 表写入', (afterAnalysis?.an ?? 0) > (before?.an ?? 0), JSON.stringify(afterAnalysis))

  // A11 记录今天
  await link('A11')
  await delay(2500)
  for (const label of ['30-60', '能', '加重']) {
    const found = dump().find((n) => n.text === label)
    if (found) sh(`input tap ${found.cx} ${found.cy}`)
    await delay(400)
  }
  const wf = dump().filter((n) => n.isField).sort((a, b) => a.y1 - b.y1)[0]
  if (wf) sh(`input tap ${wf.cx} ${wf.cy}`)
  await delay(600)
  sh('input text "worried about getting worse"')
  sh('input keyevent 111')
  await delay(400)
  const saveBtn = dump().find((n) => n.text.includes('保存今天的记录'))
  if (saveBtn) sh(`input tap ${saveBtn.cx} ${saveBtn.cy}`)
  await delay(4000)
  const afterToday = dbCounts()
  check('记录今天后 symptom_log 写入', (afterToday?.lg ?? 0) > (before?.lg ?? 0), JSON.stringify(afterToday))

  // A12 复诊摘要
  await link('A12')
  await delay(2500)
  const genBtn = dump().find((n) => n.text.includes('生成六段草稿'))
  if (genBtn) sh(`input tap ${genBtn.cx} ${genBtn.cy}`)
  await delay(4000)
  const afterFollowup = dbCounts()
  check('复诊摘要生成后 followup_summary 写入', (afterFollowup?.fu ?? 0) > (before?.fu ?? 0), JSON.stringify(afterFollowup))

  console.log(`\nAndroid 写操作：${pass} 通过, ${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('失败:', e instanceof Error ? e.stack : e)
  process.exit(1)
})
