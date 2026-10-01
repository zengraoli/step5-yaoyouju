import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:5203'
const PORT = Number(process.env.PORT ?? 9980)
const NAME = process.env.NAME ?? 'super01'
const PAGES = JSON.parse(process.env.APAGES ?? '[]')

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, `--window-size=${process.env.W || 1440},${process.env.H || 900}`, '--no-first-run', '--user-data-dir=/tmp/yyj-admin-' + PORT, 'about:blank'], { stdio: 'ignore' })
await delay(1500)
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pend = new Map()
const evs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') evs.push(JSON.stringify(m.params.args))
})
const send = (method, params = {}) => new Promise((r) => { id += 1; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value
const waitFor = async (sel, ms = 10000) => {
  for (let i = 0; i < ms / 250; i++) {
    const n = await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
    if (n > 0) return true
    await delay(250)
  }
  return false
}

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.W || 1440), height: Number(process.env.H || 900), deviceScaleFactor: 1, mobile: false })
// 登录
await send('Page.navigate', { url: BASE + '/login' })
await delay(2500)
await ev('(function(){var e=document.querySelector("input[type=text]");if(e){e.value=' + JSON.stringify(NAME) + ';e.dispatchEvent(new Event("input",{bubbles:true}))}return 1})()')
await ev('(function(){var e=document.querySelector("input[type=password]");if(e){e.value="123456";e.dispatchEvent(new Event("input",{bubbles:true}))}return 1})()')
await ev('(function(){var e=document.querySelectorAll("input[type=text]")[1];if(e){e.value="123456";e.dispatchEvent(new Event("input",{bubbles:true}))}return 1})()')
await delay(300)
await ev('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return (x.innerText||"").indexOf("登录")>=0})[0];b.click();return 1})()')
await delay(3000)
console.log('login →', await ev('location.pathname'))
// 首次登录需绑定 MFA
const mfaBtn = await ev('[].slice.call(document.querySelectorAll("button")).filter(function(b){return (b.innerText||"").indexOf("绑定动态验证码")>=0}).length')
if (mfaBtn > 0) {
  await ev('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return (x.innerText||"").indexOf("绑定动态验证码")>=0})[0];b.click();return 1})()')
  await delay(2500)
  await ev('(function(){var e=document.querySelector("input");if(e){e.value="123456";e.dispatchEvent(new Event("input",{bubbles:true}))}return 1})()')
  await ev('(function(){var b=[].slice.call(document.querySelectorAll("button")).filter(function(x){return (x.innerText||"").indexOf("绑定并进入后台")>=0})[0];b.click();return 1})()')
  await delay(2500)
  console.log('mfa bound →', await ev('location.pathname'))
}
let pass = 0, fail = 0
for (const p of PAGES) {
  await send('Page.navigate', { url: BASE + p.path })
  await delay(p.wait ?? 2500)
  if (p.waitFor) await waitFor(p.waitFor, 6000)
  const txt = String(await ev('document.body.innerText') || '')
  const where = await ev('location.pathname')
  if (p.expectPath && where !== p.expectPath) { console.log(`✗ ${NAME} ${p.path} 应在 ${p.expectPath}，实际 ${where}`); fail++; continue }
  const missing = (p.expect ?? []).filter((e) => !txt.includes(e))
  const absent = (p.expectAbsent ?? []).filter((e) => txt.includes(e))
  const ok = missing.length === 0 && absent.length === 0
  if (ok) pass++; else fail++
  console.log(`${ok ? '✓' : '✗'} ${NAME} ${p.path}`, missing.length ? '缺少:' + missing.join('/') : '', absent.length ? '不该有:' + absent.join('/') : '')
}
console.log(`\n${NAME}: ${pass} 通过, ${fail} 失败（console errors: ${evs.length}）`)
if (evs.length) console.log('errors:', [...new Set(evs)].slice(0, 3))
ws.close(); chrome.kill()
process.exit(fail > 0 ? 1 : 0)
