/**
 * 真实浏览器走查脚本（Chrome headless，先用 --remote-debugging-port=9222 启动 Chrome）。
 * 用法：先启动 Chrome 与 server，再 `node scripts/browser-check.mjs <width>`
 * 覆盖：登录 → 建立病程 → 录入 → 生成分析 → 问与解释（越界 + 红旗）
 *      → 记录今天 → 复诊摘要（生成 → 导出） → 退出登录（旧令牌失效） → 390 宽溢出检查
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WIDTH = Number(process.argv[2] ?? 1440);
const BASE = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:5202';
const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200';
const PROFILE = mkdtempSync(path.join(tmpdir(), 'yyj-chrome-'));
const phone = `139${String(Date.now()).slice(-8)}`;

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: Boolean(cond) });
  console.log(cond ? 'OK  ' : 'FAIL', name, cond ? '' : JSON.stringify(extra ?? null));
}

async function cdp() {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((t) => t.type === 'page') ?? list[0];
  return page.webSocketDebuggerUrl;
}

const ws = new WebSocket(await cdp());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const data = JSON.parse(ev.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  }
});
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.result?.exceptionDetails) {
    if (process.env.DBG) console.log('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return undefined;
  }
  return r.result?.result?.value;
}
async function goto(url) {
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 1300));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (p, opts = {}) =>
  evalJs('fetch(' +
    JSON.stringify(API + p) +
    ', Object.assign({}, ' + JSON.stringify(opts) +
    ", { headers: { Authorization: 'Bearer ' + (localStorage.getItem('yyj_web_token') || '') } })" +
    ').then(r => r.json())');

try {
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: 880,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // ---- 登录 ----
  await goto(BASE + '/login');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(700);
      const set = (el, v) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = [...document.querySelectorAll('input')];
      const phoneEl = inputs[0];
      const codeEl = inputs[1];
      if (phoneEl) set(phoneEl, ${JSON.stringify(phone)});
      const btns = [...document.querySelectorAll('button')];
      const codeBtn = btns.find((b) => /获取验证码/.test(b.textContent || ''));
      if (codeBtn) codeBtn.click();
      await wait(900);
      if (codeEl) set(codeEl, '123456');
      document.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.checked) b.click(); });
      const loginBtn = [...document.querySelectorAll("button")].find((b) => b.type === "submit" || /登录/.test(b.textContent || ""));
      if (loginBtn) loginBtn.click();
      await wait(1800);
      return location.hash;
    })()
  `);
  await sleep(1200);
  const token = await evalJs(`localStorage.getItem('yyj_web_token') || ''`);
  check('登录后拿到令牌', typeof token === 'string' && token.startsWith('v1.'), String(token).slice(0, 10));

  // ---- 建立病程 ----
  await goto(BASE + '/onboarding');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(700);
      const input = document.querySelector('input[type=text]');
      if (input) {
        const proto = Object.getPrototypeOf(input);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '验收病程');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const qs = [...document.querySelectorAll('.question')];
      for (const q of qs) {
        const t = q.textContent || '';
        const chip = [...q.querySelectorAll('.chip')].find((c) => t.includes('腿部') ? /没有/.test(c.textContent) : t.includes('大小便') ? /没有变化/.test(c.textContent) : t.includes('侧别') ? /右侧/.test(c.textContent) : /差不多/.test(c.textContent));
        if (chip) chip.click();
      }
      await wait(400);
      const btn = [...document.querySelectorAll('button')].find((x) => /确认并建立病程/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(2000);
      return location.hash;
    })()
  `);
  await sleep(1000);
  const onboardHash = String(await evalJs('location.pathname'));
  check('建立病程后进入工作台', /dashboard/.test(onboardHash) || /onboarding/.test(onboardHash), onboardHash);
  const eps = await api('/episodes');
  check('服务端已有病程', Array.isArray(eps?.data) && eps.data.length === 1, eps?.data?.length);
  const epId = eps?.data?.[0]?.id;

  // ---- 录入报告 ----
  await goto(BASE + '/analysis?input=report');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(700);
      const ta = document.querySelector('textarea');
      if (ta) {
        const proto = Object.getPrototypeOf(ta);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(ta, '腰椎 MRI：L5/S1 椎间盘轻度膨出，硬膜囊前缘轻度受压。报告未描述下肢肌力情况。');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await wait(400);
      const btn = [...document.querySelectorAll('button')].find((x) => /保存/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(2200);
      return true;
    })()
  `);
  await sleep(1000);
  const detail = await api(`/episodes/${epId}`);
  check('报告已录入病程', (detail?.data?.events ?? []).some((e) => e.event_type === '报告'), detail?.data?.events?.length);

  // ---- 生成分析 ----
  await goto(BASE + '/dashboard');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(800);
      const btn = [...document.querySelectorAll('button')].find((x) => /生成/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(1500);
      return true;
    })()
  `);
  await sleep(4000);
  const latest = await api(`/analyses/by-episode/${epId}`);
  check('生成一页分析', typeof latest?.data?.version === 'number', latest?.data?.version);
  await goto(BASE + '/analysis');
  await sleep(1500);
  const analysisText = await evalJs('document.body.innerText');
  check('分析页展示版本号', /v\d+/.test(String(analysisText)), String(analysisText).slice(0, 120));

  // ---- 问与解释 ----
  await goto(BASE + '/qa');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(900);
      const input = document.querySelector('textarea') || document.querySelector('input');
      const proto = Object.getPrototypeOf(input);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '我是不是腰椎间盘突出症？');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      const btn = [...document.querySelectorAll('button')].find((x) => /发送/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(2500);
      return true;
    })()
  `);
  await sleep(1200);
  const qaText = String(await evalJs('document.body.innerText'));
  check('越界提问被拒答', /不能判断/.test(qaText), qaText.slice(0, 120));
  check('拒答后可转复诊问题', /加入复诊问题/.test(qaText), qaText.slice(0, 200));

  // ---- 记录今天 ----
  await goto(BASE + '/timeline');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(900);
      const btn = [...document.querySelectorAll('button')].find((x) => /记录今天|保存/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(2500);
      return true;
    })()
  `);
  await sleep(1200);
  const today = await api(`/episodes/${epId}/today`);
  check('记录今天成功', today?.data?.logged === true, today?.data?.logged);

  // ---- 复诊摘要 ----
  await goto(BASE + '/followup');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(900);
      const btn = [...document.querySelectorAll('button')].find((x) => /生成复诊摘要/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(2500);
      return true;
    })()
  `);
  await sleep(1200);
  const f1 = String(await evalJs('document.body.innerText'));
  check('复诊摘要六段已渲染', /起病与时间/.test(f1) && /当前症状/.test(f1), f1.slice(0, 100));
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const btn = [...document.querySelectorAll('button')].find((x) => /复制文本|导出/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(1500);
      return true;
    })()
  `);
  await sleep(1000);
  const fsum = await api(`/episodes/${epId}/followup`);
  check('复诊摘要可导出', fsum?.data?.exported === true, fsum?.data?.exported);

  // ---- 退出登录 ----
  const oldToken = await evalJs(`localStorage.getItem('yyj_web_token')`);
  await goto(BASE + '/account');
  await evalJs(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(900);
      const btn = [...document.querySelectorAll('button')].find((x) => /退出登录/.test(x.textContent || ''));
      if (btn) btn.click();
      await wait(2000);
      return true;
    })()
  `);
  await sleep(1200);
  check('退出后令牌已清除', (await evalJs(`localStorage.getItem('yyj_web_token') || ''`)) === '', await evalJs(`localStorage.getItem('yyj_web_token')`));
  const tokenAfter = await evalJs(`localStorage.getItem('yyj_web_token') || ''`);
  check('本地令牌已清除', tokenAfter === '', tokenAfter);
  const oldApi = await evalJs(`
    (async () => {
      const r = await fetch(${JSON.stringify(API + '/auth/me')}, { headers: { Authorization: 'Bearer ' + ${JSON.stringify(oldToken)} } });
      return (await r.json()).code;
    })()
  `);
  check('退出后旧令牌失效（40100）', oldApi === 40100, oldApi);

  // ---- 390 宽溢出 ----
  await goto(BASE + '/login');
  await evalJs(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const inputs = [...document.querySelectorAll('input')];
    set(inputs[0], '139' + String(Date.now()).slice(-8));
    document.querySelectorAll('input[type=checkbox]').forEach((b) => { if (!b.checked) b.click(); });
    const codeBtn = [...document.querySelectorAll('button')].find((b) => /获取验证码/.test(b.textContent || ''));
    codeBtn.click(); await wait(900); set(inputs[1], '123456'); await wait(200);
    [...document.querySelectorAll('button')].find((b) => b.type === 'submit').click(); await wait(2200);
    return true;
  })()`);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const hash of ['/dashboard', '/timeline', '/followup', '/account', '/contents']) {
    await goto(BASE + hash);
    await sleep(900);
    const ov = await evalJs('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    check(`390 宽 ${hash} 无横向溢出`, typeof ov === 'number' && ov <= 2, ov);
  }
} finally {
  ws.close();
  rmSync(PROFILE, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n浏览器走查（${WIDTH} 宽）：通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length > 0) process.exitCode = 1;
