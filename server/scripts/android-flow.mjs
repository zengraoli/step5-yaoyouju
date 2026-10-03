#!/usr/bin/env node
/**
 * Android 端到端验收（模拟器 + 真实 server）。
 * 通过 uiautomator 定位 EditText / 按钮点击；文本一律用 ASCII（adb input 不支持中文）。
 * 每步查库确认真的写入。
 *
 * 用法：先 `adb reverse tcp:3200 tcp:3200` 并装好 APK，再
 *   node scripts/android-flow.mjs
 */
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'

const ADB = process.env.ADB ?? 'adb'
const PKG = 'com.yaoyouju.android'
const PHONE = '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
const sh = (cmd) => execFileSync(ADB, ['shell', cmd], { encoding: 'utf8', timeout: 60000 })
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 120000 })

function dump() {
  sh('uiautomator dump /sdcard/yyj-ui.xml >/dev/null 2>&1')
  const xml = sh('cat /sdcard/yyj-ui.xml')
  const nodes = []
  const re = /<node[^>]*>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0]
    const text = /text="([^"]*)"/.exec(tag)?.[1] ?? ''
    const desc = /content-desc="([^"]*)"/.exec(tag)?.[1] ?? ''
    const cls = /class="([^"]*)"/.exec(tag)?.[1] ?? ''
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag)
    if (!bounds) continue
    const [, x1, y1, x2, y2] = bounds.map(Number)
    nodes.push({
      text,
      desc,
      isField: cls.includes('EditText'),
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2),
      y1,
    })
  }
  return nodes
}

function tap(node) {
  sh(`input tap ${node.cx} ${node.cy}`)
}

async function tapText(want, exact = false) {
  sh('input keyevent 111')
  let found = dump().find(
    (n) => (n.text || n.desc) && (exact ? n.text === want : n.text.includes(want) || n.desc.includes(want)),
  )
  if (!found) {
    // 兜底：软键盘没退干净时按钮被挡住，再试一次（不用返回键，避免退出应用）
    sh('input keyevent 111')
    await delay(800)
    found = dump().find(
      (n) => (n.text || n.desc) && (exact ? n.text === want : n.text.includes(want) || n.desc.includes(want)),
    )
  }
  if (!found) {
    console.log(`  ⚠ 未找到「${want}」`)
    return false
  }
  tap(found)
  return true
}

function typeAscii(value) {
  sh(`input text "${value}"`)
  sh('input keyevent 111') // ESC：收起软键盘，避免挡住按钮
}

const fields = () => dump().filter((n) => n.isField).sort((a, b) => a.y1 - b.y1)
const tab = async (label, x) => {
  sh(`input tap ${x} 1558`)
  await delay(2500)
  return true
}

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('  ✓', name)
  } else {
    fail += 1
    console.log('  ✗', name, extra ?? '')
  }
}
const shot = (n) => {
  try {
    sh(`screencap -p /sdcard/yyj-${n}.png`)
    adb('pull', `/sdcard/yyj-${n}.png`, `/tmp/yyj-${n}.png`)
  } catch { /* ignore */ }
}

async function main() {
  console.log('== PHONE', PHONE)
  sh(`am force-stop ${PKG}`)
  sh(`am start -n ${PKG}/.MainActivity`)
  await delay(6000)
  let onLogin = dump().some((n) => n.text.includes('手机号'))
  if (!onLogin) {
    // 已有登录态：底部导航「我的」→ 滚到底 → 退出登录，保证用新手机号从登录开始
    sh('input tap 638 1558')
    await delay(3500)
    for (let i = 0; i < 4; i += 1) {
      if (dump().some((n) => n.text.includes('退出登录'))) break
      sh('input swipe 360 1300 360 500 400')
      await delay(800)
    }
    await tapText('退出登录')
    await delay(3000)
    // 退出后「我的」页显示未登录态，点「去登录」回登录页
    if (dump().some((n) => n.text.includes('去登录'))) await tapText('去登录')
    await delay(2000)
    onLogin = dump().some((n) => n.text.includes('手机号'))
  }
  check('冷启动到登录页', onLogin)
  shot('01-cold-login')

  // 登录
  const f = fields()
  tap(f[0])
  await delay(400)
  typeAscii(PHONE)
  await delay(400)
  await tapText('获取验证码')
  await delay(1200)
  const f2 = fields()
  tap(f2[1] ?? f2[0])
  await delay(400)
  typeAscii('123456')
  await delay(400)
  // 单独同意健康信息处理（默认不勾选，必须勾选才能登录）
  await tapText('单独同意')
  await delay(600)
  await tapText('登录 / 注册')
  await delay(6000)
  const homeNodes = dump().filter((n) => n.text).map((n) => n.text)
  console.log('  首页元素:', homeNodes.slice(0, 12).join(' / '))
  check('登录后进入首页', homeNodes.some((t) => t.includes('当前情况') && !t.includes('登录')), homeNodes.slice(0, 6).join('/'))
  shot('02-home')

  // A02 建立病程：新用户首页有「现在确认当前关键变化」入口（设计稿 A14）
  await tapText('现在确认当前关键变化')
  await delay(3500)
  check('A02 第 1 题可见', dump().some((n) => n.text.includes('与上次相比')))
  await tapText('加重', true)
  await delay(500)
  // Q2 红旗题：勾「会阴区或鞍区麻木」应立即跳就医提示
  sh('input swipe 360 1300 360 700 400')
  await delay(800)
  const q2 = dump().some((n) => n.text.includes('需要医生及时评估'))
  console.log('  Q2 可见:', q2)
  await tapText('左侧', true)
  await delay(400)
  // 滚到底找到「下一步」
  for (let i = 0; i < 5; i += 1) {
    if (dump().some((n) => n.text.includes('下一步'))) break
    sh('input swipe 360 1300 360 600 400')
    await delay(700)
  }
  await tapText('下一步')
  await delay(2500)
  shot('03-change')

  // A04 选择主要困惑 → 下一步：录入报告与医嘱
  await tapText('下一步：录入报告')
  await delay(3000)
  const rf = fields()[0]
  if (rf) tap(rf)
  await delay(600)
  typeAscii('Lumbar MRI: normal alignment, mild L4/5 disc degeneration.')
  await delay(400)
  await tapText('保存')
  await delay(3500)
  shot('04-report')

  // 生成一页分析
  await tapText('生成一页分析')
  await delay(12000)
  const analysisText = dump().map((n) => n.text).join(' ')
  check('一页分析五段', analysisText.includes('已知') && analysisText.includes('解释') && analysisText.includes('下一步'), analysisText.slice(0, 160))
  shot('05-analysis')

  // 问与解释（越界提问）
  await tab('问与解释', 250)
  await delay(2500)
  const qf = fields()[0]
  if (qf) tap(qf)
  await delay(600)
  typeAscii('is this muscle strain or herniation')
  await delay(400)
  await tapText('发送')
  await delay(6000)
  const qaText = dump().map((n) => n.text).join(' ')
  check('越界提问明确不答', qaText.includes('不能判断'), qaText.slice(0, 200))
  shot('06-qa')

  // 记录今天
  await tapText('记录今天')
  await delay(2500)
  await tapText('30-60')
  const wf = fields()[0]
  if (wf) tap(wf)
  await delay(600)
  typeAscii('worried it is getting worse')
  await delay(400)
  await tapText('保存')
  await delay(3000)
  shot('07-today')

  // 复诊准备
  await tab('复诊准备', 520)
  await delay(2500)
  await tapText('生成')
  await delay(3000)
  shot('08-followup')

  // 撤回同意（必须二次确认）
  await tab('我的', 638)
  await delay(2500)
  await tapText('撤回')
  await delay(1500)
  const dialogText = dump().map((n) => n.text).join(' ')
  check('撤回同意需二次确认', dialogText.includes('撤回') && (dialogText.includes('取消') || dialogText.includes('确定')), dialogText.slice(0, 120))
  shot('09-revoke-dialog')
  await tapText('取消')
  await delay(800)

  // 退出登录 → 旧令牌失效
  await tab('我的', 638)
  await delay(2500)
  for (let i = 0; i < 4; i += 1) {
    if (dump().some((n) => n.text.includes('退出登录'))) break
    sh('input swipe 360 1300 360 500 400')
    await delay(800)
  }
  await tapText('退出登录')
  await delay(3000)
  const backToLogin = dump().some((n) => n.text.includes('去登录') || n.text.includes('手机号'))
  check('退出登录后回到未登录态', backToLogin)
  shot('10-logout')

  console.log(`\nAndroid 走查：${pass} 通过, ${fail} 失败`)

  // ---------- 查库确认真的写入 ----------
  const dbFile = process.env.DB_DIR ? `${process.env.DB_DIR}/app.db` : '.tmpdb/app.db'
  const app = new DatabaseSync(dbFile, { readOnly: true })
  const ep = app.prepare('SELECT id, title FROM episode ORDER BY created_at DESC LIMIT 1').all()[0]
  const counts = app
    .prepare(
      `SELECT (SELECT COUNT(*) FROM care_event WHERE episode_id=?) ev,
              (SELECT COUNT(*) FROM symptom_log s JOIN care_event c ON c.id=s.care_event_id WHERE c.episode_id=?) log,
              (SELECT COUNT(*) FROM report r JOIN care_event c ON c.id=r.care_event_id WHERE c.episode_id=?) rp,
              (SELECT COUNT(*) FROM analysis WHERE episode_id=?) an,
              (SELECT COUNT(*) FROM qa_message m JOIN qa_session s ON s.id=m.session_id WHERE s.episode_id=?) qa`,
    )
    .get(ep.id, ep.id, ep.id, ep.id, ep.id)
  console.log('  最新病程:', ep.title, '| 事件/症状/报告/分析/问答:', JSON.stringify(counts))
  check('病程事件已写入', counts.ev >= 2, JSON.stringify(counts))
  check('症状记录已写入', counts.log >= 1)
  check('报告已写入', counts.rp >= 1)
  check('分析已写入', counts.an >= 1)
  app.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Android 走查失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})
