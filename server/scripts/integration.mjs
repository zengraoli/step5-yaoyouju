/**
 * 三端联调验证（T40）：App / Web 提交的反馈、举报和安全事件在后台可见并写入审计；
 * 举报初筛（运营编辑）与临床复核处置（临床审核）分别可用；后台关闭「个性化分析」后
 * 用户端显示回退；内容一键下线后用户端不可见、后台可定位引用。
 *
 * 用法：先启动 server（npm run dev）与 worker（npm run worker），再执行
 *   node scripts/integration.mjs
 *
 * 注意：脚本会把一条已发布内容下线（链路 4）。重复运行会累积下线内容，
 * 需要重置演示数据时删除 server/data/*.db 后重启 server 即可重新播种。
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'

/** 后台演示口令 / TOTP（.env 的 ADMIN_DEMO_PASSWORD / ADMIN_TOTP_DEMO_CODE，默认演示值） */
const ADMIN_PASSWORD = process.env.ADMIN_DEMO_PASSWORD ?? '123456'
const ADMIN_TOTP = process.env.ADMIN_TOTP_DEMO_CODE ?? '123456'

async function req(url, method = 'GET', data, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('✓', name)
  } else {
    fail += 1
    console.log('✗', name, extra ?? '')
  }
}

async function waitTask(taskId, token) {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const t = await req(`/analyses/task/${taskId}`, 'GET', null, token)
    if (t.body.data?.status !== 'queued') return t.body.data
  }
  return null
}

/** 后台登录（失败时给出明确中文原因，不再抛 null 读取错误） */
async function adminLogin(name) {
  const res = await req('/admin/auth/login', 'POST', { name, password: ADMIN_PASSWORD, totp: ADMIN_TOTP })
  const token = res.body?.data?.token
  if (!token) {
    throw new Error(`后台账号 ${name} 登录失败：${res.body?.message ?? `HTTP ${res.status}`}`)
  }
  return token
}

async function main() {
  // 链路 1：反馈 / 举报 / 安全事件 → 后台可见 + 审计
  const login = await req('/auth/login', 'POST', { phone: '13800001234', code: '123456' })
  if (login.body?.code !== 0) throw new Error(`用户登录失败：${login.body?.message ?? '未知原因'}`)
  const ut = login.body.data.token
  // 自建病程与症状记录：脚本可重复运行，不依赖演示种子数据的具体状态
  const epRes = await req('/episodes', 'POST', { title: '联调病程', onset_date: '2026-09-01' }, ut)
  const ep = epRes.body.data
  await req(`/episodes/${ep.id}/events`, 'POST', {
    event_type: '症状',
    source_type: '自述',
    occurred_at: new Date().toISOString(),
    raw_text: '久坐 4 小时后腰部酸痛，起身活动可缓解；不影响睡眠',
    verify_status: '已确认',
  }, ut)
  const an = await req('/analyses', 'POST', { episode_id: ep.id }, ut)
  if (an.body?.code !== 0 || an.body.data?.status !== 'queued') {
    throw new Error(`提交分析失败（期望排队任务）：${an.body?.message ?? JSON.stringify(an.body?.data ?? {})}`)
  }
  const task = await waitTask(an.body.data.task_id, ut)
  const analysis = task?.analysis
  check('分析任务完成（Worker 消费）', Boolean(analysis))
  if (!analysis) throw new Error('分析未完成，无法继续联调（请确认 npm run worker 正在运行）')

  await req('/feedback', 'POST', { analysis_id: analysis.id, help_type: '看懂了' }, ut)
  await req('/feedback/error-report', 'POST', {
    analysis_id: analysis.id,
    category: '与我的报告不符',
    description: '联调举报：解释与报告不一致',
    severity: 'high',
  }, ut)
  const redflag = await req('/analyses', 'POST', {
    episode_id: ep.id,
    symptom_change: '会阴部麻木，大小便控制困难',
  }, ut)
  check('红旗命中 40911（不创建任务）', redflag.status === 409 && redflag.body.code === 40911)

  // 运营编辑可看举报队列并初筛；临床审核做临床复核处置
  const et = await adminLogin('editor01')
  const queue = await req('/admin/feedback?type=error_report', 'GET', null, et)
  const queueItems = queue.body.data?.items ?? []
  check('运营编辑可见举报队列（含 high）', Array.isArray(queueItems) && queueItems.some((q) => q.severity === 'high'), queue.body.message)
  const reportId = queueItems[0]?.id
  if (reportId) {
    const triage = await req(`/admin/feedback/${reportId}/triage`, 'POST', {
      action: '待临床复核',
      comment: '联调初筛：转临床复核',
    }, et)
    check('运营编辑可提交举报初筛', triage.body.code === 0, triage.body.message)
  }
  const events = await req('/admin/safety/events', 'GET', null, et)
  check('后台安全事件可见（RF-01）', Array.isArray(events.body.data?.items) && events.body.data.items.some((e) => e.rule_code === 'RF-01'))
  const clt = await adminLogin('clinician01')
  if (reportId) {
    const handled = await req(`/admin/feedback/${reportId}/handle`, 'POST', {
      action: '转内容修正',
      comment: '联调处置：转内容修正',
    }, clt)
    check('临床审核可提交复核处置', handled.body.code === 0, handled.body.message)
  }
  // 审计查看需要 audit.view（合规支持 / 超级管理）
  const compliance = await adminLogin('compliance01')
  const audit = await req('/admin/audit?page=1&page_size=50', 'GET', null, compliance)
  check('后台处置写入审计', Array.isArray(audit.body.data?.items) && audit.body.data.items.some((a) => a.action.includes('feedback')))
  // 命中红旗的病程：之后每次提交分析都必须被拦截（产品红线：不再生成个性化分析）
  const blocked = await req('/analyses', 'POST', { episode_id: ep.id, symptom_change: '继续观察' }, ut)
  check('命中红旗后同病程再提交分析被拦截（40911）', blocked.status === 409 && blocked.body.code === 40911, blocked.body.message)
  // 用一个没有红旗的新病程做后续开关链路
  const freshEp = await req('/episodes', 'POST', { title: '联调开关验证' }, ut)
  const freshEpId = freshEp.body.data.id

  // 链路 2：高危开关（个性化分析）双人确认 → 回退 / 恢复
  const tech = await adminLogin('tech01')
  const superToken = await adminLogin('super01')
  const setSwitch = async (enabled) => {
    const started = await req(
      '/admin/safety/switches/个性化分析',
      'PUT',
      { enabled, reason: `联调${enabled ? '恢复' : '关闭'}个性化分析` },
      tech,
    )
    if (started.body.code === 0) return started
    const cid = started.body.data?.confirmation_id
    if (!cid) throw new Error(`开关变更失败：${started.body.message ?? '未知原因'}`)
    // 另一名具备对应角色的账号确认并执行（技术负责人 + 临床审核 / 超级管理员）
    return req(`/admin/confirmations/${cid}/approve`, 'POST', {}, superToken)
  }
  const switchedOff = await setSwitch(false)
  check('高危开关变更需双人确认后生效', switchedOff.body.code === 0, switchedOff.body.message)
  const fallback = await req('/analyses', 'POST', { episode_id: freshEpId }, ut)
  check('关闭个性化分析后返回回退', fallback.body.data?.status === 'fallback', fallback.body.message)
  const switchedOn = await setSwitch(true)
  check('恢复个性化分析开关（双人确认）', switchedOn.body.code === 0, switchedOn.body.message)
  const normal = await req('/analyses', 'POST', { episode_id: freshEpId }, ut)
  check('恢复开关后正常排队', normal.body.data?.status === 'queued', normal.body.message)

  // 链路 3：内容下线 → 用户端不可见 + 引用定位
  const contents = await req('/contents', 'GET', null, ut)
  const target = contents.body.data?.[0]
  if (!target) throw new Error('没有可下线的已发布内容')
  const impact = await req(`/admin/contents/${target.id}/impact`, 'GET', null, clt)
  check('下线前引用定位可查', impact.status === 200)
  // 一键下线必须双人确认：临床审核发起 → 超级管理员确认后才真正下线
  const offline = await req(`/admin/contents/${target.id}/take-offline`, 'POST', { reason: '联调' }, clt)
  check(
    '一键下线需双人确认（临床审核发起返回 409 + 待确认清单）',
    offline.status === 409 && Array.isArray(offline.body.data?.pending) && offline.body.data.pending.length === 1,
    offline.body.message,
  )
  // 临床审核本人不能确认（同一个人）
  const selfConfirm = await req(`/admin/confirmations/${offline.body.data.pending[0].confirmation_id}/approve`, 'POST', {}, clt)
  check('同一人不能确认自己的下线申请（409）', selfConfirm.status === 409, selfConfirm.body.message)
  // 超级管理员在自己的会话里确认并执行
  const confirmed = await req(`/admin/confirmations/${offline.body.data.pending[0].confirmation_id}/approve`, 'POST', {}, superToken)
  check('超级管理员确认后真正下线', confirmed.body.code === 0, confirmed.body.message)
  const contentsAfter = await req('/contents', 'GET', null, ut)
  check('下线后用户端不可见', Array.isArray(contentsAfter.body.data) && !contentsAfter.body.data.some((c) => c.id === target.id))
  const adminDetail = await req(`/admin/contents/${target.id}`, 'GET', null, clt)
  check('后台仍可查看下线内容', adminDetail.body.code === 0)

  // 链路 4：退出登录后旧令牌立即失效
  const meBefore = await req('/auth/me', 'GET', null, ut)
  check('退出前 /auth/me 正常', meBefore.body.code === 0)
  const out = await req('/auth/logout', 'POST', {}, ut)
  check('退出登录成功', out.body.code === 0)
  const meAfter = await req('/auth/me', 'GET', null, ut)
  check('退出后旧令牌失效（401）', meAfter.body.code === 40100, meAfter.body.message)
  const adminMe = await req('/admin/auth/me', 'GET', null, et)
  check('后台退出前可查询自身', adminMe.body.code === 0)
  const adminOut = await req('/admin/auth/logout', 'POST', {}, et)
  check('后台退出登录成功', adminOut.body.code === 0)
  const adminMeAfter = await req('/admin/auth/me', 'GET', null, et)
  check('后台退出后旧令牌失效（401）', adminMeAfter.body.code === 40100, adminMeAfter.body.message)

  console.log(`\n联调结果: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('联调失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})
