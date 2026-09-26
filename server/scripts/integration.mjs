/**
 * 三端联调验证（T40）：App / Web 提交的反馈、举报和安全事件在后台可见并写入审计；
 * 后台关闭「个性化分析」后用户端显示回退；内容一键下线后用户端不可见、后台可定位引用。
 *
 * 用法：先启动 server（npm run dev）与 worker（npm run worker），再执行
 *   node scripts/integration.mjs
 *
 * 注意：脚本会把一条已发布内容下线（链路 3）。重复运行会累积下线内容，
 * 需要重置演示数据时删除 server/data/*.db 后重启 server 即可重新播种。
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'

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
function check(name, cond) {
  if (cond) {
    pass += 1
    console.log('✓', name)
  } else {
    fail += 1
    console.log('✗', name)
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

async function main() {
  // 链路 1：反馈 / 举报 / 安全事件 → 后台可见 + 审计
  const login = await req('/auth/login', 'POST', { phone: '13800001234', code: '123456' })
  const ut = login.body.data.token
  const eps = await req('/episodes', 'GET', null, ut)
  const ep = eps.body.data.find((e) => e.status === '进行中') ?? eps.body.data[0]
  const an = await req('/analyses', 'POST', { episode_id: ep.id }, ut)
  const task = await waitTask(an.body.data.task_id, ut)
  const analysis = task?.analysis
  check('分析任务完成（Worker 消费）', Boolean(analysis))
  if (!analysis) throw new Error('分析未完成，无法继续联调')

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

  const compliance = await req('/admin/auth/login', 'POST', { name: 'compliance01', password: '123456', totp: '123456' })
  const ct = compliance.body.data.token
  const queue = await req('/admin/feedback', 'GET', null, ct)
  check('后台举报队列可见（含 high）', queue.body.data.some((q) => q.severity === 'high'))
  const events = await req('/admin/safety/events', 'GET', null, ct)
  check('后台安全事件可见（RF-01）', events.body.data.items.some((e) => e.rule_code === 'RF-01'))
  await req(`/admin/feedback/${queue.body.data[0].id}/handle`, 'POST', { action: '转内容修正', comment: '联调处置' }, ct)
  const audit = await req('/admin/audit?page=1&page_size=50', 'GET', null, ct)
  check('后台处置写入审计', audit.body.data.items.some((a) => a.action.includes('feedback')))

  // 链路 2：开关 → 回退
  const tech = await req('/admin/auth/login', 'POST', { name: 'tech01', password: '123456', totp: '123456' })
  const tt = tech.body.data.token
  await req('/admin/safety/switches/个性化分析', 'PUT', { enabled: false, reason: '联调' }, tt)
  const fallback = await req('/analyses', 'POST', { episode_id: ep.id }, ut)
  check('关闭个性化分析后返回回退', fallback.body.data?.status === 'fallback')
  await req('/admin/safety/switches/个性化分析', 'PUT', { enabled: true, reason: '联调' }, tt)
  const normal = await req('/analyses', 'POST', { episode_id: ep.id }, ut)
  check('恢复开关后正常排队', normal.body.data?.status === 'queued')

  // 链路 3：内容下线 → 用户端不可见 + 引用定位
  const contents = await req('/contents', 'GET', null, ut)
  const target = contents.body.data[0]
  const clinician = await req('/admin/auth/login', 'POST', { name: 'clinician01', password: '123456', totp: '123456' })
  const clt = clinician.body.data.token
  const impact = await req(`/admin/contents/${target.id}/impact`, 'GET', null, clt)
  check('下线前引用定位可查', impact.status === 200)
  const offline = await req(`/admin/contents/${target.id}/take-offline`, 'POST', { reason: '联调' }, clt)
  check('一键下线成功', offline.body.code === 0)
  const contentsAfter = await req('/contents', 'GET', null, ut)
  check('下线后用户端不可见', !contentsAfter.body.data.some((c) => c.id === target.id))
  const adminDetail = await req(`/admin/contents/${target.id}`, 'GET', null, clt)
  check('后台仍可查看下线内容', adminDetail.body.code === 0)

  console.log(`\n联调结果: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('联调失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})
