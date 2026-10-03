/**
 * 后台五角色页面走查（dev 与生产构建各一遍；每个角色一个独立浏览器）。
 * 用法：node scripts/admin-five-roles.mjs [baseUrl]
 */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const BASE = process.argv[2] ?? 'http://127.0.0.1:5203'
const W = Number(process.env.W ?? 1440)
const H = Number(process.env.H ?? 900)

const ROLES = [
  {
    name: 'editor01',
    pages: [
      { path: '/dashboard', expect: ['待办','安全事件'] },
      { path: '/contents', expect: ['内容'] },
      { path: '/contents', expect: ['···'] },
      { path: '/feedback', expect: ['举报'] },
    ],
  },
  {
    name: 'clinician01',
    pages: [
      { path: '/dashboard', expect: ['待办','安全事件'] },
      { path: '/contents', expect: ['内容'] },
      { path: '/evidence', expect: ['证据'] },
      { path: '/feedback', expect: ['举报'] },
    ],
  },
  {
    name: 'tech01',
    pages: [
      { path: '/dashboard', expect: ['待办','安全事件'] },
      { path: '/safety', expect: ['开关'] },
      { path: '/models', expect: ['模型'] },
      { path: '/eval', expect: ['评测'] },
    ],
  },
  {
    name: 'compliance01',
    pages: [
      { path: '/dashboard', expect: ['待办','安全事件'] },
      { path: '/users', expect: ['成员'] },
      { path: '/audit', expect: ['审计'] },
    ],
  },
  {
    name: 'super01',
    pages: [
      { path: '/dashboard', expect: ['待办','安全事件'] },
      { path: '/contents', expect: ['内容'] },
      { path: '/evidence', expect: ['证据'] },
      { path: '/feedback', expect: ['举报'] },
      { path: '/safety', expect: ['开关'] },
      { path: '/models', expect: ['模型'] },
      { path: '/eval', expect: ['评测'] },
      { path: '/users', expect: ['成员'] },
      { path: '/audit', expect: ['审计'] },
      { path: '/cases', expect: ['案例'] },
    ],
  },
];

let totalPass = 0
let totalFail = 0

for (const role of ROLES) {
  const port = 9800 + Math.floor(Math.random() * 150)
  const chrome = spawn(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--window-size=${W},${H}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/yyj-r5-${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  await delay(1500)
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pend = new Map()
  const errs = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push(String((m.params.args ?? []).map((a) => a.value ?? '').join(' ')))
    } else if (m.method === 'Runtime.exceptionThrown') {
      errs.push(String(m.params?.exceptionDetails?.text ?? 'exception'))
    }
  })
  const send = (method, params = {}) =>
    new Promise((r) => {
      id += 1
      pend.set(id, r)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const ev = async (expr) =>
    String((await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value ?? '')
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })

  // 登录（账号 + 口令 + TOTP）
  await send('Page.navigate', { url: BASE + '/login' })
  await delay(2500)
  const fill = async (sel, value) => {
    await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'none';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()`)
  }
  await fill('input[type=text]', role.name)
  await fill('input[type=password]', '123456')
  await ev("(function(){var e=document.querySelectorAll('input[type=text]')[1];if(!e)return 'none';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'123456');e.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()")
  await delay(300)
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return (x.innerText||'').indexOf('登录')>=0})[0];if(b)b.click();return 1})()`)
  await delay(3500)
  // 首次登录绑定 MFA（口令 + 演示码）
  const needMfa = await ev(`[].slice.call(document.querySelectorAll('button')).filter(function(b){return (b.innerText||'').indexOf('绑定')>=0}).length`)
  if (Number(needMfa) > 0) {
    await fill('input[type=password]', '123456')
    await ev("(function(){var e=document.querySelectorAll('input[type=text]')[0];if(!e)return 'none';var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'123456');e.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()")
    await ev(`(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return (x.innerText||'').indexOf('绑定并进入')>=0})[0];if(b)b.click();return 1})()`)
    await delay(3000)
  }
  console.log(`\n[${role.name}] 登录后：${await ev('location.pathname')}`)

  for (const p of role.pages) {
    await send('Page.navigate', { url: BASE + p.path })
    await delay(2600)
    const txt = await ev('document.body.innerText')
    const missing = p.expect.filter((e) => !txt.includes(e))
    const ok = missing.length === 0
    if (ok) totalPass += 1
    else totalFail += 1
    console.log(`  ${ok ? '✓' : '✗'} ${p.path}${missing.length ? ' 缺少:' + missing.join('/') : ''}`)
  }
  if (errs.length) console.log(`  console errors:`, [...new Set(errs)].slice(0, 3))
  ws.close()
  chrome.kill()
  await delay(800)
}

console.log(`\n五角色页面走查：${totalPass} 通过, ${totalFail} 失败（${W}×${H}）`)
process.exit(totalFail > 0 ? 1 : 0)
