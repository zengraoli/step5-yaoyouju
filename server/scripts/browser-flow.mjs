#!/usr/bin/env node
/**
 * Web / 后台 浏览器全流程验收（本机 Chrome 无头 + CDP，不关闭跨域检查）。
 *
 * 用法：
 *   node scripts/browser-flow.mjs <baseUrl> <label> <flowFile.json>
 * flowFile.json: { "steps": [{ "path": "/login", "fill": [["input[type=text]","13800000001"]], "click": "登录 / 注册", "expect": ["..."], "wait": 8000 }] }
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const base = process.argv[2]
const label = process.argv[3]
const flowRaw = readFileSync(process.argv[4], 'utf8')
// 支持 ${PHONE} 占位（每次验收用新手机号，避免复用已有数据）
const phone = process.env.PHONE ?? '137' + String(Date.now()).slice(-8)
const flow = JSON.parse(flowRaw.replace(/\$\{PHONE\}/g, phone))
console.log(`[${label}] 使用手机号 ${phone}`)
const width = Number(process.env.WIDTH ?? 1440)
const height = Number(process.env.HEIGHT ?? 900)
const port = 9600 + Math.floor(Math.random() * 300)

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=/tmp/yyj-flow-${port}`,
  'about:blank',
], { stdio: 'ignore' })

async function findTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const page = (await res.json()).find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* wait */
    }
    await delay(250)
  }
  throw new Error('Chrome 未就绪')
}

function cdp(ws) {
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result)
      pending.delete(msg.id)
    } else if (msg.method) events.push(msg)
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
async function runStep(api, step, idx) {
  api.events.length = 0
  if (step.path) {
    await api.send('Page.navigate', { url: base.replace(/\/$/, '') + step.path })
  }
  await delay(step.wait ?? 2500)
  // 等待关键文案出现（SPA 数据加载完成后再断言，避免误报）
  if (step.waitForText) {
    for (let i = 0; i < 40; i += 1) {
      const r = await api.send('Runtime.evaluate', {
        expression: `document.body.textContent.includes(${JSON.stringify(step.waitForText)})`,
        returnByValue: true,
      })
      if (r?.result?.result?.value === true || r?.result?.value === true) break
      await delay(300)
    }
  }
  // 等待关键元素出现（SPA 需要时间挂载）
  if (step.waitFor) {
    const want = step.waitFor
    for (let i = 0; i < 20; i += 1) {
      const r = await api.send('Runtime.evaluate', {
        expression: `document.querySelectorAll(${JSON.stringify(want)}).length`,
        returnByValue: true,
      })
      if ((r?.result?.result?.value ?? 0) > 0) break
      await delay(300)
    }
  }
  // 填表：["选择器","值"] 或 ["选择器","值",第几个]
  for (const [selector, value, index] of step.fill ?? []) {
    // 等元素出现（SPA 挂载 / 页面跳转）
    for (let i = 0; i < 30; i += 1) {
      const probe = await api.send('Runtime.evaluate', {
        expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
        returnByValue: true,
      })
      if ((probe?.result?.result?.value ?? 0) > 0) break
      await delay(300)
    }
    const result = await api.send('Runtime.evaluate', {
      expression: `(() => {
        const list = document.querySelectorAll(${JSON.stringify(selector)});
        const wantIndex = ${index === undefined ? 'undefined' : String(index)};
        const el = wantIndex === undefined ? list[0] : list[wantIndex];
        if (!el) return 'no-element';
        el.focus();
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      })()`,
      returnByValue: true,
    })
    if (result?.result?.value !== 'ok') console.log('   ⚠ 未找到输入框', selector, index)
    await delay(120)
  }
  // 勾选复选框：点 label（点 input 会被 label 的默认行为二次触发）
  for (const selector of step.check ?? []) {
    await api.send('Runtime.evaluate', {
      expression: `(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        for (const el of els) {
          const box = el.tagName === 'INPUT' ? el : el.querySelector('input');
          if (box && !box.checked) el.click();
        }
        return els.length;
      })()`,
      returnByValue: true,
    })
    await delay(150)
  }
  // 截图（SHOTS=1 时逐步保存，便于人工核对页面）
  if (process.env.SHOTS) {
    try {
      const shot = await api.send('Page.captureScreenshot', { format: 'png' })
      const fs = await import('node:fs')
      fs.mkdirSync('scripts/.shots', { recursive: true })
      fs.writeFileSync(`scripts/.shots/${String(idx + 1).padStart(2, '0')}-${(step.name ?? 'step').replace(/[^\w\u4e00-\u9fa5]+/g, '_')}.png`, Buffer.from(shot.data, 'base64'))
    } catch { /* 忽略截图失败 */ }
  }
  // 调试：直接执行一段 JS 并打印结果
  if (step.probe) {
    await api.send('Runtime.enable')
    const r = await api.send('Runtime.evaluate', { expression: step.probe, returnByValue: true })
    console.log('   [probe]', String(r?.result?.result?.value ?? r?.result?.value ?? '').slice(0, 600))
  }
  // 点击（图标按钮用 clickSelector 指定 CSS 选择器）
  if (step.clickSelector) {
    await api.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(step.clickSelector)}); if (!el) return 'no-element'; el.click(); return 'ok' })()`,
      returnByValue: true,
    })
    await delay(step.afterClick ?? 3000)
  }
  // 点击
  if (step.click) {
    await api.send('Runtime.evaluate', {
      expression: `(() => {
        const want = ${JSON.stringify(step.click)};
        const exact = ${step.clickExact ? 'true' : 'false'};
        // uni-app H5 把按钮渲染成 uni-button / uni-view 自定义元素，必须一起找
        const els = [...document.querySelectorAll('button,a,.chip,uni-button,uni-view,uni-text')];
        const match = (e) => (exact ? (e.innerText || '').trim() === want : (e.innerText || '').trim().includes(want));
        // 点「最深」的匹配元素：外层容器也包含同样的文字，点它不会触发业务点击
        const depth = (e) => { let d = 0; let n = e; while ((n = n.parentElement)) d += 1; return d }
        const sorted = els.filter(match).sort((a, b) => depth(b) - depth(a))
        // 优先点真正的可交互元素（button / uni-button / a）：uni-app 的点击监听挂在组件根元素上
        const interactive = sorted.filter((e) => /^(BUTTON|UNI-BUTTON|A)$/.test(e.tagName))
        const el = interactive[0] ?? sorted[0]
        if (!el) return 'no-button'
        el.click()
        return 'ok'
      })()`,
      returnByValue: true,
    })
    await delay(step.afterClick ?? 3000)
  }
  // 每次取值前重新启用 Runtime，避免导航后上下文被清空导致取到空
  await api.send('Runtime.enable')
  // 用 textContent 取全文：uni-app H5 的 innerText 在部分容器上会漏掉子元素文字
  const doc = await api.send('Runtime.evaluate', { expression: 'document.body.textContent', returnByValue: true })
  const text = String(doc?.result?.result?.value ?? doc?.result?.value ?? '')
  const errors = []
  const netErrors = []
  for (const ev of api.events) {
    if (ev.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(ev.params?.type)) {
      errors.push((ev.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (ev.method === 'Runtime.exceptionThrown') errors.push(ev.params?.exceptionDetails?.text ?? 'exception')
    if (ev.method === 'Network.loadingFailed') netErrors.push(ev.params?.errorText ?? '')
    if (ev.method === 'Network.responseReceived' && (ev.params?.response?.status ?? 0) >= 400) {
      netErrors.push(`${ev.params.response.url} → ${ev.params.response.status}`)
    }
  }
  const bad = [...netErrors].filter((e) => !/favicon/.test(e))
  const missing = (step.expect ?? []).filter((e) => !text.includes(e))
  const absent = (step.expectAbsent ?? []).filter((e) => text.includes(e))
  if (process.env.DEBUG) {
    const loc = await api.send('Runtime.evaluate', { expression: 'location.pathname + location.search', returnByValue: true })
    console.log('   [loc]', JSON.stringify(loc).slice(0, 200))
    console.log('   [text]', text.slice(0, 200))
  }
  const ok = errors.length === 0 && bad.length === 0 && missing.length === 0 && absent.length === 0
  if (!ok) totalFail += 1
  console.log(`${ok ? '✓' : '✗'} [${label}] 步骤${idx + 1} ${step.name ?? step.path ?? step.click}`)
  if (missing.length) console.log('   缺少文案:', missing.join(' / '))
  if (absent.length) console.log('   不应出现:', absent.join(' / '))
  if (bad.length) console.log('   失败请求:', [...new Set(bad)].slice(0, 4).join(' | '))
  if (errors.length) console.log('   控制台错误:', [...new Set(errors)].slice(0, 4).join(' | '))
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
  await api.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
  for (const [i, step] of flow.steps.entries()) await runStep(api, step, i)
  ws.close()
  chrome.kill()
  console.log(`\n[${label}] ${flow.steps.length - totalFail}/${flow.steps.length} 步骤通过（${width}×${height}）`)
  process.exit(totalFail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('流程验收失败:', e instanceof Error ? e.message : e)
  chrome.kill()
  process.exit(1)
})
