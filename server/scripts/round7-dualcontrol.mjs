/**
 * 第七轮验收反馈第 6 / 13 / 14 / 15 条：双人确认与越权治理接口复查（全新数据库）。
 * 覆盖：
 *  - 只有一名超管时引导式新增第二名超管（第 6、7 条）；
 *  - 超管不能借「自己设定过口令的账号」完成双人确认或审计导出审批（第 6 条）；
 *  - 每类双人确认连续做三轮（第 6、15 条）；
 *  - 确认单列表不返回口令哈希（第 13 条）；
 *  - 模型提升 / 回滚确认单标题带目标（第 14 条）；
 *  - 技术负责人第一次点开关就生成确认单（第 15 条）。
 *
 * 用法：全新数据库启动 server（npm run dev）后执行
 *   node scripts/round7-dualcontrol.mjs
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'
const SEED_PW = '123456' // 种子账号口令
const PW = '12345678' // 邀请账号口令（服务端要求至少 8 位）
const TOTP = '123456'

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) {
    pass += 1
    console.log('✓', name)
  } else {
    fail += 1
    console.log('✗', name, extra ?? '')
  }
}

async function req(url, method = 'GET', data, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function adminLogin(name, password) {
  const r = await req('/admin/auth/login', 'POST', { name, password, totp: TOTP })
  if (r.body?.code !== 0) throw new Error(`登录失败 ${name}: ${r.body?.message}`)
  return r.body.data.token
}

async function bindMfa(token, password) {
  const r = await req('/admin/auth/bind-mfa', 'POST', { password, totp: TOTP }, token)
  if (r.body?.code !== 0) throw new Error(`绑定 MFA 失败: ${r.body?.message}`)
}

async function main() {
  const A = await adminLogin('super01', SEED_PW)
  const stamp = Date.now().toString().slice(-6)
  const superB = `super${stamp}`

  // ---------- 1. 只有一名超管：引导式新增第二名超管 ----------
  const inviteB = await req('/admin/users', 'POST', { name: superB, role: '超级管理员', password: PW }, A)
  check('只有一名超管时可直接新增第二名超管（引导分支，第 6、7 条）', inviteB.body.code === 0, inviteB.body.message)
  const B = await adminLogin(superB, PW)
  await bindMfa(B, PW)

  // ---------- 2. 超管自建账号不能互认（第 6 条） ----------
  const techName = `tech${stamp}`
  await req('/admin/users', 'POST', { name: techName, role: '技术负责人', password: PW }, A)
  const T = await adminLogin(techName, PW)
  await bindMfa(T, PW)

  const sw = await req('/admin/safety/switches/个性化分析', 'PUT', { enabled: false, reason: '第七轮双人确认复查' }, T)
  check('技术负责人点开关即生成确认单（第一次点击就弹双人确认，第 15 条）', sw.body.code === 40900 && !!sw.body.data?.confirmation_id, sw.body.message)
  const switchCid = sw.body.data?.confirmation_id
  const bApprove = await req(`/admin/confirmations/${switchCid}/approve`, 'POST', {}, B)
  check('发起人邀请的超管不能确认（同邀请根，第 6 条）', bApprove.body.code !== 0, bApprove.body.message)
  const aApprove = await req(`/admin/confirmations/${switchCid}/approve`, 'POST', {}, A)
  check('发起人本人不能确认自己的确认单', aApprove.body.code !== 0, aApprove.body.message)
  const list = await req('/admin/confirmations', 'GET', null, A)
  const items = (list.body.data ?? {}).items ?? []
  check('确认单列表不返回口令哈希（第 13 条）', items.every((i) => !('password_hash' in (i.payload ?? {}))), JSON.stringify(items[0]?.payload))
  await req(`/admin/confirmations/${switchCid}/cancel`, 'POST', {}, T)

  // ---------- 3. 第 6(a) 条：自建合规账号申请审计导出，邀请人不能审批 ----------
  const compName = `comp${stamp}`
  await req('/admin/users', 'POST', { name: compName, role: '合规支持', password: PW }, A)
  const C = await adminLogin(compName, PW)
  await bindMfa(C, PW)
  const expReq = await req('/admin/audit/export-request', 'POST', { reason: '第七轮越权复查' }, C)
  check('合规账号可提交审计导出申请', expReq.body.code === 0, expReq.body.message)
  const requestId = (expReq.body.data ?? {}).id
  const aApproveExp = await req('/admin/audit/export-approve', 'POST', { request_id: requestId }, A)
  check('邀请人（超管）不能审批自建合规账号的导出申请（第 6a 条）', aApproveExp.body.code !== 0, aApproveExp.body.message)
  const bApproveExp = await req('/admin/audit/export-approve', 'POST', { request_id: requestId }, B)
  check('同根超管也不能审批（第 6a 条）', bApproveExp.body.code !== 0, bApproveExp.body.message)
  const cApproveExp = await req('/admin/audit/export-approve', 'POST', { request_id: requestId }, C)
  check('申请人本人不能审批自己的导出申请', cApproveExp.body.code !== 0, cApproveExp.body.message)

  // ---------- 4. 每类双人确认连续三轮（种子技术 / 临床 + 无关联的第二名超管） ----------
  const T2 = await adminLogin('tech01', SEED_PW)
  for (let round = 1; round <= 3; round += 1) {
    const key = round % 2 === 1 ? '个性化分析' : '案例卡片'
    const init = await req(`/admin/safety/switches/${key}`, 'PUT', { enabled: round % 2 === 1, reason: `第七轮第 ${round} 轮` }, T2)
    const cid = init.body.data?.confirmation_id
    const done = cid ? await req(`/admin/confirmations/${cid}/approve`, 'POST', {}, B) : { body: { code: -1, message: init.body.message } }
    check(`高危开关双人确认第 ${round} 轮（技术 + 无关联超管）`, init.body.code === 40900 && !!cid && done.body.code === 0, done.body.message)
  }

  const releases = await req('/admin/models', 'GET', null, T2)
  const list2 = (releases.body.data ?? [])
  // 新建一个候选发布并跑过必需评测集，使其可被提升为「生效」，从而构造出两个生效发布
  const sets = ((await req('/admin/eval/sets', 'GET', null, T2)).body.data ?? [])
  const requiredSets = (sets).filter((x) => x.required !== false)
  const created = await req('/admin/models', 'POST', {
    model_name: '第七轮复查模型',
    prompt_version: 'prompt-v7',
    retrieval_strategy: '关键词 + 本地向量混合检索（证据库内）',
    content_lib_version: 'content-lib-v7',
  }, T2)
  const candidate = (created.body.data ?? {}).id
  if (candidate) {
    for (const set of requiredSets) {
      const run = await req('/admin/eval/runs', 'POST', { model_release_id: candidate, eval_set_id: set.id, trigger_reason: '第七轮复查' }, T2)
      check(`评测集 ${set.id.slice(0, 8)} 运行完成`, run.body.code === 0, run.body.message)
    }
  }
  // 每轮新建一个候选并跑过门禁后「提升 + 回滚」；另建一个长期候选作为回滚兜底
  const mkCandidate = async (suffix) => {
    const c = await req('/admin/models', 'POST', {
      model_name: `第七轮复查模型${suffix}`,
      prompt_version: `prompt-v7${suffix}`,
      retrieval_strategy: '关键词 + 本地向量混合检索（证据库内）',
      content_lib_version: `content-lib-v7${suffix}`,
    }, T2)
    const id = (c.body?.data ?? {}).id
    if (!id) return null
    for (const set of requiredSets) {
      await req('/admin/eval/runs', 'POST', { model_release_id: id, eval_set_id: set.id, trigger_reason: '第七轮复查' }, T2)
    }
    return id
  }
  const fallbackRelease = await mkCandidate('-兜底')
  for (let round = 1; round <= 3; round += 1) {
    const rel = await mkCandidate(`-${round}`)
    if (!rel || !fallbackRelease) {
      check(`模型双人确认第 ${round} 轮`, false, '候选发布创建失败')
      continue
    }
    const pr = await req(`/admin/models/${rel}/promote`, 'POST', {}, T2)
    const pcid = pr.body.data?.confirmation_id
    const pdone = pcid ? await req(`/admin/confirmations/${pcid}/approve`, 'POST', {}, B) : { body: { code: -1, message: pr.body.message } }
    check(`模型提升双人确认第 ${round} 轮`, pr.body.code === 40900 && !!pcid && pdone.body.code === 0, pdone.body.message)
    const rb = await req(`/admin/models/${rel}/rollback`, 'POST', { reason: `第七轮回滚第 ${round} 轮` }, T2)
    const rcid = rb.body.data?.confirmation_id
    const rdone = rcid ? await req(`/admin/confirmations/${rcid}/approve`, 'POST', {}, B) : { body: { code: -1, message: rb.body.message } }
    check(`模型回滚双人确认第 ${round} 轮`, rb.body.code === 40900 && !!rcid && rdone.body.code === 0, rdone.body.message)
  }
  // 第 14 条：新建一条回滚确认单，从「待我确认」列表里核对标题带目标发布
  const titleRel = await mkCandidate('-标题')
  if (titleRel) {
    const pr = await req(`/admin/models/${titleRel}/promote`, 'POST', {}, T2)
    const pcid = pr.body.data?.confirmation_id
    if (pcid) await req(`/admin/confirmations/${pcid}/approve`, 'POST', {}, B)
    const rb = await req(`/admin/models/${titleRel}/rollback`, 'POST', { reason: '第七轮标题核对' }, T2)
    const conf = await req('/admin/confirmations', 'GET', null, A)
    const confItems = (conf.body.data ?? {}).items ?? []
    const modelItems = confItems.filter((i) => i.action.startsWith('model.'))
    check(
      '模型提升 / 回滚确认单标题带目标发布（第 14 条）',
      rb.body.code === 40900 && modelItems.length > 0 && modelItems.every((i) => i.target_label && i.target_label.length > 0),
      JSON.stringify(modelItems[0]) + ' / ' + rb.body.message,
    )
    const rcid = rb.body.data?.confirmation_id
    if (rcid) await req(`/admin/confirmations/${rcid}/cancel`, 'POST', {}, T2)
  }

  const CL = await adminLogin('clinician01', SEED_PW)
  const contents = await req('/admin/contents', 'GET', null, A)
  const published = ((contents.body.data ?? {}).items ?? []).filter((i) => i.status === '已发布')
  for (let round = 1; round <= 3; round += 1) {
    const target = published[round - 1] ?? published[0]
    if (!target) {
      check(`内容撤回双人确认第 ${round} 轮`, false, '没有已发布内容')
      continue
    }
    const init = await req(`/admin/contents/${target.id}/withdraw`, 'POST', { reason: `第七轮撤回第 ${round} 轮` }, CL)
    const pending = init.body.data?.pending?.[0]?.confirmation_id
    const done = pending ? await req(`/admin/confirmations/${pending}/approve`, 'POST', {}, B) : { body: { code: -1, message: init.body.message } }
    check(`内容撤回双人确认第 ${round} 轮（临床 + 无关联超管）`, !!pending && done.body.code === 0, done.body.message)
  }

  // 停用超级管理员必须双人确认：A 停用 B（B 是 A 邀请的，不能自确认）
  for (let round = 1; round <= 3; round += 1) {
    const users = await req('/admin/users', 'GET', null, A)
    const bRow = (users.body.data ?? []).find((u) => u.name === superB)
    const init = await req(`/admin/users/${bRow.id}/status`, 'POST', { active: false, reason: `第七轮停用第 ${round} 轮` }, A)
    const cid = init.body.data?.confirmation_id
    const bTry = cid ? await req(`/admin/confirmations/${cid}/approve`, 'POST', {}, B) : { body: { code: -1 } }
    check(`停用超管必须双人确认且同根不能确认（第 ${round} 轮）`, init.body.code === 40900 && !!cid && bTry.body.code !== 0, init.body.message)
    if (cid) {
      const cx = await req(`/admin/confirmations/${cid}/cancel`, 'POST', {}, A)
      if (cx.body.code !== 0) console.log('   （撤销确认单失败：', cx.body.message, '）')
    }
  }

  console.log(`\n双人确认复查：${pass} 通过, ${fail} 失败`)
  process.exitCode = fail > 0 ? 1 : 0
}

main().catch((e) => {
  console.error('复查失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})
