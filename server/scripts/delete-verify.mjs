/**
 * 删除账户闭环验收（第八轮第 4 条）：申请 → 模拟冷静期结束（仅在本隔离演示库把 effective_at 提前）→ 确认删除 → 查库确认数据清除。
 * 只操作本项目端口与隔离演示库；不改产品逻辑、不清其他用户数据。
 * 用法：先启动 server（本脚本用 API_BASE_URL），DB 用同目录 .verifydb/app.db。
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'
const { DatabaseSync } = await import('node:sqlite')
const path = await import('node:path')
const fs = await import('node:fs')

const DB_FILE = process.env.VERIFY_DB ?? path.join(process.cwd(), '.verifydb', 'app.db')

async function req(url, method = 'GET', data, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

let pass = 0, fail = 0
const check = (n, c, extra) => { c ? (pass += 1, console.log('✓', n)) : (fail += 1, console.log('✗', n, extra ?? '')) }

async function main() {
  const phone = '139' + String(Date.now()).slice(-8)
  const login = await req('/auth/login', 'POST', { phone, code: '123456' })
  const token = login.body.data.token
  check('新用户登录', login.body.code === 0)
  await req('/auth/consents', 'POST', { scope: '健康信息处理' }, token)
  // 造一些数据，之后要能被清除
  const ep = await req('/episodes', 'POST', { title: '删除账户用例' }, token)
  await req(`/episodes/${ep.body.data.id}/events`, 'POST', { event_type: '症状', source_type: '自述', occurred_at: new Date().toISOString(), raw_text: '久坐后腰酸，活动后可缓解', verify_status: '尚未确认' }, token)
  // 查到 user_id（用于查库核对）
  const me = await req('/auth/me', 'GET', null, token)
  const userId = me.body.data.id
  console.log('测试手机号', phone, 'userId', userId.slice(0, 8))

  // 1. 申请删除（验证码二次确认 → 冷静期）
  const dr = await req('/auth/delete-request', 'POST', { phone, code: '123456' }, token)
  check('申请删除成功，进入冷静期', dr.body.code === 0, dr.body.message)
  //  错误验证码不应通过
  const badCode = await req('/auth/delete-request', 'POST', { phone, code: '000000' }, token)
  check('错误验证码不能申请删除', badCode.body.code !== 0)

  const meBefore = await req('/auth/me', 'GET', null, token)
  check('冷静期内 can_confirm=false', meBefore.body.data.deletion && meBefore.body.data.deletion.can_confirm === false, JSON.stringify(meBefore.body.data.deletion))
  //   冷静期内确认删除应被拒
  const early = await req('/auth/delete-confirm', 'POST', { phone, code: '123456' }, token)
  check('冷静期内提前确认被拒', early.body.code !== 0, early.body.message)

  // 2. 模拟冷静期结束：只把本隔离库中该用户的 effective_at 提前（产品逻辑不变）
  const db = new DatabaseSync(DB_FILE)
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const upd = db.prepare(`UPDATE deletion_request SET effective_at = ? WHERE user_id = ? AND status = '冷静期中'`).run(past, userId)
  console.log('模拟冷静期结束：更新', Number(upd.changes), '行')
  db.close()

  const meAfter = await req('/auth/me', 'GET', null, token)
  check('冷静期结束后 can_confirm=true', meAfter.body.data.deletion && meAfter.body.data.deletion.can_confirm === true, JSON.stringify(meAfter.body.data.deletion))

  // 3. 确认删除（硬删全部数据）
  const dc = await req('/auth/delete-confirm', 'POST', { phone, code: '123456' }, token)
  check('确认删除成功', dc.body.code === 0, dc.body.message)

  // 4. 查库：该用户在各表的记录应为 0
  const db2 = new DatabaseSync(DB_FILE, { readOnly: true })
  const tables = ['care_event', 'episode', 'analysis', 'analysis_task', 'safety_event', 'consent', 'deletion_request', 'symptom_log']
  const cleanAll = []
  for (const t of tables) {
    try {
      const r = db2.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id = ?`).get(userId)
      cleanAll.push(`${t}=${r.n}`)
      check(`库内 ${t} 已清除`, r.n === 0, `仍 ${r.n} 条`)
    } catch (e) {
      // symptom_log / analysis_task 可能无 user_id 列，忽略
    }
  }
  // 隔离身份库：手机号加密记录应清除
  const idFile = path.join(path.dirname(DB_FILE), 'identity.db')
  if (fs.existsSync(idFile)) {
    const idb = new DatabaseSync(idFile, { readOnly: true })
    try {
      const ir = idb.prepare('SELECT COUNT(*) n FROM identity_profile WHERE user_id = ?').get(userId)
      check('identity_profile 已清除', ir.n === 0, `仍 ${ir.n} 条`)
    } catch (e) { console.log('   identity_profile 查询跳过:', e.message) }
    idb.close()
  }
  db2.close()

  // 5. 重新登录同一手机号 → 全新用户，无病程
  const reLogin = await req('/auth/login', 'POST', { phone, code: '123456' })
  const newToken = reLogin.body.data.token
  await req('/auth/consents', 'POST', { scope: '健康信息处理' }, newToken)
  const newMe = await req('/auth/me', 'GET', null, newToken)
  const eps = await req('/episodes', 'GET', null, newToken)
  check('同号再登录为全新用户（无病程）', Array.isArray(eps.body.data) && eps.body.data.length === 0, JSON.stringify(eps.body.data))

  console.log(`\n删除账户闭环：${pass} 通过, ${fail} 失败`)
  process.exitCode = fail > 0 ? 1 : 0
}
main().catch((e) => { console.error('执行失败:', e instanceof Error ? e.stack : e); process.exit(1) })
