/**
 * 第八轮（F8）独立新编 100 条 —— 真实接口级验收。
 * 每条说法都用「新用户 + 新病程」走 POST /analyses，统计真实命中率与误判率
 * （与纯函数 scripts/round8-cases.ts 结果应当一致）。
 * 用法：先启动 server（npm run dev 或 npm start），再执行 node scripts/round8-api.mjs
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'
import { ROUND9_TRIGGER, ROUND9_NOT } from './round9-data.mjs'

async function req(url, method = 'GET', data, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

let seq = Math.floor(Math.random() * 1e8)
async function newUser() {
  const phone = '138' + String((seq += 1)).padStart(8, '0')
  const login = await req('/auth/login', 'POST', { phone, code: '123456' })
  const token = login.body?.data?.token
  if (!token) throw new Error(`登录失败：${login.body?.message ?? '未知原因'}`)
  await req('/auth/consents', 'POST', { scope: '健康信息处理' }, token)
  return token
}

async function blocked(text) {
  const token = await newUser()
  const ep = await req('/episodes', 'POST', { title: 'F8 安全规则用例' }, token)
  const r = await req('/analyses', 'POST', { episode_id: ep.body.data.id, symptom_change: text }, token)
  const notice = r.body.data?.safety_notice
  return (
    r.body.code === 40910 ||
    r.body.code === 40911 ||
    (r.status === 202 && Boolean(notice)) ||
    (r.status === 200 && Boolean(notice))
  )
}

async function main() {
  const missed = []
  const fp = []
  for (const t of ROUND9_TRIGGER) {
    if (!(await blocked(t))) {
      missed.push(t)
      console.log('MISS', t)
    }
  }
  for (const t of ROUND9_NOT) {
    if (await blocked(t)) {
      fp.push(t)
      console.log('FP', t)
    }
  }
  console.log('')
  console.log(`应触发命中：${ROUND9_TRIGGER.length - missed.length}/${ROUND9_TRIGGER.length}`)
  console.log(`不应触发误判：${fp.length}/${ROUND9_NOT.length}`)
  if (missed.length) console.log('未命中：', missed.join(' | '))
  if (fp.length) console.log('误判：', fp.join(' | '))
  const bad = missed.length + fp.length
  process.exitCode = bad > 0 ? 1 : 0
  console.log(bad === 0 ? '\n接口级：全部通过' : `\n接口级：${bad} 条不达标`)
}

main().catch((e) => {
  console.error('执行失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})
