/**
 * Android 真机 UI 驱动小助手（F9 验收用，仅操作 com.yaoyouju.android + 本项目 tcp:3200）。
 * 用法：node scripts/f9-android-ui.mjs <command> [args]
 *  command:
 *    dump                      打印当前界面可见 text/bounds（找坐标用）
 *    tap-text <文本>            点包含该文本的元素中心
 *    text <字符串>              向当前焦点输入框输入（adb input text）
 *    key <keycode>              发送按键（66=回车/搜索）
 *    find <文本>                只判断界面是否包含某文本（exit 0/1）
 *  需要 -s emulator-5554 在 PATH 里可用 adb。
 */
import { execFileSync } from 'node:child_process'

const ADB = 'adb'
const DEV = '-s'
const SERIAL = process.env.ANDROID_SERIAL ?? 'emulator-5554'
const [, , cmd, ...rest] = process.argv

function adb(args) {
  return execFileSync(ADB, [DEV, SERIAL, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 })
}
function center(bounds) {
  // bounds="[x1,y1][x2,y2]"
  const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!m) return null
  const [x1, y1, x2, y2] = m.slice(1).map(Number)
  return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)]
}
function nodes() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/_f9ui.xml'])
  const xml = adb(['shell', 'cat', '/sdcard/_f9ui.xml'])
  const out = []
  const re = /<node[^>]*>/g
  let m
  while ((m = re.exec(xml))) {
    const tag = m[0]
    const text = /text="([^"]*)"/.exec(tag)?.[1] ?? ''
    const desc = /content-desc="([^"]*)"/.exec(tag)?.[1] ?? ''
    const bounds = /bounds="([^"]*)"/.exec(tag)?.[1] ?? ''
    out.push({ text, desc, bounds })
  }
  return out
}
function findNode(q) {
  return nodes().find((n) => (n.text && n.text.includes(q)) || (n.desc && n.desc.includes(q)))
}

if (cmd === 'dump') {
  const seen = new Set()
  for (const n of nodes()) {
    const t = n.text || n.desc
    if (t && t.trim() && !seen.has(t)) { seen.add(t); console.log(t, n.bounds) }
  }
} else if (cmd === 'tap-text') {
  const q = rest[0]
  const n = findNode(q)
  if (!n) { console.error('NOT FOUND:', q); process.exit(2) }
  const c = center(n.bounds)
  adb(['shell', 'input', 'tap', String(c[0]), String(c[1])])
  console.log('tapped', q, c.join(','))
} else if (cmd === 'text') {
  // adb input text 不识别中文与空格；中文用 UTF-8 谓词逐字，这里主要输数字/英文
  const s = rest.join(' ')
  adb(['shell', 'input', 'text', s.replace(/ /g, '%s')])
  console.log('typed', s)
} else if (cmd === 'key') {
  adb(['shell', 'input', 'keyevent', rest[0]])
  console.log('key', rest[0])
} else if (cmd === 'find') {
  const q = rest[0]
  const n = findNode(q)
  console.log(n ? ('FOUND: ' + q) : ('MISSING: ' + q))
  process.exit(n ? 0 : 1)
} else {
  console.error('unknown command', cmd)
  process.exit(1)
}
