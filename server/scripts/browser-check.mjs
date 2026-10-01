#!/usr/bin/env node
/**
 * 浏览器验收（本机 Chrome 无头 + CDP，不关闭跨域检查）。
 *
 * 逐页打开指定路径，收集：
 * - 控制台 error / 未被捕获的异常（含英文技术异常原文）
 * - 失败的网络请求（4xx / 5xx / CORS）
 * - 页面关键文案（用于确认页面真的渲染出来了）
 *
 * 用法：
 *   PAGES='[{"path":"/login","expect":"登录"}]' node scripts/browser-check.mjs http://127.0.0.1:5202 web
 */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const base = process.argv[2]
const label = process.argv[3]
const pages = JSON.parse(process.env.PAGES ?? '[]')
const width = Number(process.env.WIDTH ?? 1440)
const height = Number(process.env.HEIGHT ?? 900)

const port = 9222 + Math.floor(Math.random() * 500)
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=' + `/tmp/yyj-chrome-${port}`,
  'about:blank',
], { stdio: 'ignore' })

async function findTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // 等 Chrome 起来
    }
    await delay(250)
  }
  throw new Error('Chrome 调试端口未就绪')
}

function cdp(ws) {
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      id += 1
      pending.set(id, { resolve })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send, events }
}

let totalFail = 0

async function checkPage(ws, api, page) {
  api.events.length = 0
  await api.send('Page.navigate', { url: base.replace(/\/$/, '') + page.path })
  await delay(page.wait ?? 3500)
  const doc = await api.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })
  const text = String(doc?.result?.value ?? '')
  const errors = []
  const netErrors = []
  for (const ev of api.events) {
    if (ev.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(ev.params?.type)) {
      errors.push((ev.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (ev.method === 'Runtime.exceptionThrown') {
      errors.push(ev.params?.exceptionDetails?.text ?? 'exception')
    }
    if (ev.method === 'Network.loadingFailed') {
      netErrors.push(`${ev.params?.type ?? ''} ${ev.params?.errorText ?? ''}`)
    }
    if (ev.method === 'Network.responseReceived') {
      const st = ev.params?.response?.status ?? 0
      if (st >= 400) netErrors.push(`${ev.params.response.url} → ${st}`)
    }
  }
  const missing = (page.expect ?? []).filter((e) => !text.includes(e))
  const ok = errors.length === 0 && netErrors.length === 0 && missing.length === 0
  if (!ok) totalFail += 1
  console.log(`${ok ? '✓' : '✗'} [${label}] ${page.path}`)
  if (missing.length) console.log('   缺少文案:', missing.join(' / '))
  if (netErrors.length) console.log('   失败请求:', [...new Set(netErrors)].slice(0, 5).join(' | '))
  if (errors.length) console.log('   控制台错误:', [...new Set(errors)].slice(0, 5).join(' | '))
  return text
}

async function main() {
  const wsUrl = await findTarget()
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const api = cdp(ws)
  await api.send('Runtime.enable')
  await api.send('Page.enable')
  await api.send('Network.enable')
  await api.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 500,
  })
  const texts = {}
  for (const page of pages) {
    texts[page.path] = await checkPage(ws, api, page)
  }
  ws.close()
  chrome.kill()
  console.log(`\n[${label}] ${pages.length - totalFail}/${pages.length} 页通过（${width}×${height}）`)
  process.exit(totalFail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('浏览器验收失败:', e instanceof Error ? e.message : e)
  chrome.kill()
  process.exit(1)
})
