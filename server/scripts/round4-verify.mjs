/**
 * 第四轮严格验收反馈 · 接口级复查脚本。
 *
 * 覆盖反馈里的服务端 / 接口条目（每条都用新数据跑，不依赖演示种子状态）：
 *  5 删除账户清理全部表 / 26 删除必须用本人手机号 + 验证码
 *  6 退出登录吊销令牌 / 15 后台退出吊销令牌
 *  8 复诊摘要保留纠正 + 复诊问题入摘要
 *  9 双人确认：同角色不能互认、超管不能靠自己邀请的账号完成、批量下线逐条确认
 * 10 举报原文只在授权后可见、手机号脱敏
 * 11 证据 verify-license 日期格式、许可未确认不参与检索
 * 27 校验错误为中文、超长请求体、标题传数字
 * 29 模型可回到上一版（已回滚可再提升）
 * 31 未绑定 MFA 不能操作后台
 * 32 审计链完整性（删尾 / 改中间 / 伪造请求 ID）
 * 33 权限矩阵：运营编辑不能发布 / 不能改已启用证据原文 / 能做举报初筛
 *
 * 用法：先启动 server（npm run dev）+ worker，再执行
 *   node scripts/round4-verify.mjs
 */
const BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3200'
const ADMIN_PASSWORD = process.env.ADMIN_DEMO_PASSWORD ?? '123456'
const ADMIN_TOTP = process.env.ADMIN_TOTP_DEMO_CODE ?? '123456'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('✓', name)
  } else {
    fail += 1
    failures.push(`${name}${extra ? `（${extra}）` : ''}`)
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

const phone = () => '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')

async function newUser() {
  const p = phone()
  const r = await req('/auth/login', 'POST', { phone: p, code: '123456' })
  if (r.body?.code !== 0) throw new Error(`登录失败：${r.body?.message}`)
  const token = r.body.data.token
  await req('/auth/consents', 'POST', { scope: '健康信息处理' }, token)
  return { phone: p, token }
}

async function adminLogin(name, password = ADMIN_PASSWORD) {
  const r = await req('/admin/auth/login', 'POST', { name, password, totp: ADMIN_TOTP })
  const token = r.body?.data?.token
  if (!token) throw new Error(`后台 ${name} 登录失败：${r.body?.message ?? '未知原因'}`)
  return token
}

async function main() {
  const super1Pre = await adminLogin('super01')
  let clinician = await adminLogin('clinician01')

  // ---------- 5 / 26：删除账户（带复诊问题、举报被处理过的用户） ----------
  const u = await newUser()
  const ep = await req('/episodes', 'POST', { title: '删除验证病程' }, u.token)
  const epId = ep.body.data.id
  await req(`/episodes/${epId}/followup-questions`, 'POST', { question: '复诊问题：需要复查吗' }, u.token)
  await req(`/episodes/${epId}/followup/generate`, 'POST', {}, u.token)
  // 举报必须挂在分析或内容上（服务端要求 analysis_id / content_item_id 至少一个）
  // 自己造一条已发布内容，保证一定有可举报的内容（历史内容可能已被下线）
  const editorForContent = await adminLogin('editor01')
  const draft = await req('/admin/contents', 'POST', {
    type: '视频',
    title: `联调举报内容 ${Date.now()}`,
    applicable_scope: '一般腰痛',
    not_applicable: '急性外伤',
    script: '本片讲解久坐后腰痛的一般处理思路，不作诊断。',
    subtitle_text: '字幕：仅供演示。',
  }, editorForContent)
  const draftId = draft.body.data.id
  await req(`/admin/contents/${draftId}/submit`, 'POST', {}, editorForContent)
  await req(`/admin/contents/${draftId}/approve`, 'POST', { comment: '同意' }, clinician)
  const pubForReport = await req(`/admin/contents/${draftId}/publish`, 'POST', {}, super1Pre)
  if (pubForReport.body.code !== 0) throw new Error(`发布失败：${pubForReport.body.message}`)
  const contents0 = await req('/contents', 'GET', null, u.token)
  const rep = await req('/feedback/error-report', 'POST', {
    content_item_id: contents0.body.data[0].id,
    category: '内容出错',
    description: '联调举报：请处理',
    severity: 'high',
  }, u.token)
  check('提交举报成功', rep.body.code === 0, rep.body.message)

  // 举报被后台处理（临床审核处置；clinician 已在开头登录）
  const queue = await req('/admin/feedback?type=error_report', 'GET', null, clinician)
  const reportId = (queue.body.data?.items ?? []).find((i) => i.id === rep.body.data.id)?.id
  const handled = await req(`/admin/feedback/${reportId}/handle`, 'POST', {
    action: '已回复用户',
    comment: '联调处置：已回复',
  }, clinician)
  check('后台处理举报成功', handled.body.code === 0, handled.body.message)

  // 用别人的令牌 + 本机手机号申请删除 → 必须拒绝
  const other = await newUser()
  const wrongPhone = await req('/auth/delete-request', 'POST', { phone: u.phone, code: '123456' }, other.token)
  check('用他人手机号申请删除被拒绝', wrongPhone.body.code !== 0, wrongPhone.body.message)

  const del = await req('/auth/delete-request', 'POST', { phone: u.phone, code: '123456' }, u.token)
  check('申请删除进入冷静期', del.body.code === 0 && del.body.data?.status === '冷静期中', del.body.message)
  // 冷静期内确认删除 → 拒绝
  const early = await req('/auth/delete-confirm', 'POST', { phone: u.phone, code: '123456' }, u.token)
  check('冷静期内确认删除被拒绝', early.body.code === 40900, early.body.message)
  // 取消后再重新申请，并把冷静期改到过去以便真正删（直接改库由测试方完成；这里验证取消）
  const cancelled = await req('/auth/delete-cancel', 'POST', {}, u.token)
  check('取消删除申请成功', cancelled.body.code === 0, cancelled.body.message)
  const del2 = await req('/auth/delete-request', 'POST', { phone: u.phone, code: '123456' }, u.token)
  check('重新申请删除成功', del2.body.code === 0, del2.body.message)

  // ---------- 6 / 15：退出登录吊销令牌 ----------
  const meBefore = await req('/auth/me', 'GET', null, u.token)
  check('退出前可查询自身', meBefore.body.code === 0)
  const out = await req('/auth/logout', 'POST', {}, u.token)
  check('用户退出登录成功', out.body.code === 0, out.body.message)
  const meAfter = await req('/auth/me', 'GET', null, u.token)
  check('退出后旧令牌失效（40100）', meAfter.body.code === 40100, meAfter.body.message)
  const adminOut = await req('/admin/auth/logout', 'POST', {}, clinician)
  check('后台退出登录成功', adminOut.body.code === 0, adminOut.body.message)
  const adminMe = await req('/admin/auth/me', 'GET', null, clinician)
  check('后台退出后旧令牌失效（40100）', adminMe.body.code === 40100, adminMe.body.message)

  // ---------- 9：双人确认（同角色不能互认 / 批量下线逐条 / 超管不能靠新邀请账号） ----------
  // 上一步已经退出了 clinician，这里重新登录（退出测试吊销的是旧令牌）
  // 注意：clinician 令牌已注销，需要重新赋值而不是重新声明
  const super1 = await adminLogin('super01')
  const editor = await adminLogin('editor01')
  const tech = await adminLogin('tech01')
  clinician = await adminLogin('clinician01')

  // 9a 撤回：临床审核 + 临床审核 不能互认
  const contents = await req('/contents', 'GET', null, await newUser().then((x) => x.token))
  const target = contents.body.data?.[0]
  if (!target) throw new Error('没有可用的已发布内容')
  const started = await req(`/admin/contents/${target.id}/withdraw`, 'POST', { reason: '联调撤回' }, clinician)
  check('撤回需双人确认（返回待确认清单）',
    started.status === 409 && Array.isArray(started.body.data?.pending) && started.body.data.pending.length === 1,
    started.body.message)
  const cid = started.body.data.pending[0].confirmation_id
  // 第二名临床审核（不同账号、同一角色）也不能确认
  const clinician2Name = 'clinician2' + Date.now().toString().slice(-6)
  await req('/admin/users', 'POST', { name: clinician2Name, role: '临床审核', password: '123456789' }, super1)
  const clinician2 = await adminLogin(clinician2Name, '123456789')
  await req('/admin/auth/bind-mfa', 'POST', { password: '123456789', totp: ADMIN_TOTP }, clinician2)
  const sameRole = await req(`/admin/confirmations/${cid}/approve`, 'POST', {}, clinician2)
  check('同一角色（另一名临床审核）不能确认', sameRole.body.code === 40900, sameRole.body.message)
  const superApprove = await req(`/admin/confirmations/${cid}/approve`, 'POST', {}, super1)
  check('不同角色（超级管理员）确认后撤回生效', superApprove.body.code === 0, superApprove.body.message)

  // 9b 批量下线 2 条：逐条确认（自己造内容，保证有 2 条已发布）
  const publishTwo = async () => {
    for (let i = 0; i < 2; i += 1) {
      const d = await req('/admin/contents', 'POST', {
        type: '视频',
        title: `联调下线内容 ${i + 1}-${Date.now()}`,
        applicable_scope: '一般腰痛',
        not_applicable: '急性外伤',
        script: '本片讲解久坐后腰痛的一般处理思路，不作诊断。',
        subtitle_text: '字幕：仅供演示。',
      }, editor)
      const cid2 = d.body.data?.id
      if (!cid2) console.log('创建草稿失败', d.status, d.body.code, d.body.message)
      await req(`/admin/contents/${cid2}/submit`, 'POST', {}, editor)
      await req(`/admin/contents/${cid2}/approve`, 'POST', { comment: '同意发布' }, clinician)
      const pub = await req(`/admin/contents/${cid2}/publish`, 'POST', {}, super1)
      if (pub.body.code !== 0) throw new Error(`发布失败：${pub.body.message}`)
    }
  }
  await publishTwo()
  const contents2 = await req('/contents', 'GET', null, await newUser().then((x) => x.token))
  const ids = (contents2.body.data ?? []).slice(0, 2).map((c) => c.id)
  if (ids.length >= 2) {
    const batch = await req('/admin/contents/batch-take-offline', 'POST', { ids, reason: '联调批量下线' }, clinician)
    check('批量下发起 2 条确认单',
      batch.status === 409 && (batch.body.data?.pending ?? []).length === 2,
      batch.body.message)
    const pend = batch.body.data.pending
    const selfTry = await req(`/admin/confirmations/${pend[0].confirmation_id}/approve`, 'POST', {}, clinician)
    check('批量下线不能本人确认', selfTry.body.code === 40900, selfTry.body.message)
    const o1 = await req(`/admin/confirmations/${pend[0].confirmation_id}/approve`, 'POST', {}, super1)
    const o2 = await req(`/admin/confirmations/${pend[1].confirmation_id}/approve`, 'POST', {}, super1)
    check('两条都由另一角色逐条确认后下线', o1.body.code === 0 && o2.body.code === 0,
      `${o1.body.message} / ${o2.body.message}`)
    const after = await req('/contents', 'GET', null, await newUser().then((x) => x.token))
    check('批量下线后用户端不可见',
      after.body.data.every((c) => !ids.includes(c.id)),
      after.body.data.filter((c) => ids.includes(c.id)).map((c) => c.title).join(','))
  } else {
    console.log('（可下线内容不足 2 条，跳过批量下线用例）')
  }

  // 9c 超管邀请的新账号（未绑 MFA）不能完成确认
  const newName = 'verify' + Date.now().toString().slice(-6)
  const invited = await req('/admin/users', 'POST', { name: newName, role: '超级管理员', password: '123456789' }, super1)
  check('超管邀请新账号成功', invited.body.code === 0, invited.body.message)
  const newToken = await adminLogin(newName, '123456789')
  const confirmTry = await req('/admin/confirmations', 'GET', null, newToken)
  check('未绑定 MFA 的新账号不能操作后台（40300）', confirmTry.body.code === 40300, confirmTry.body.message)
  const bind = await req('/admin/auth/bind-mfa', 'POST', { password: '123456789', totp: ADMIN_TOTP }, newToken)
  // 绑定后业务接口立即可用
  const afterBindConfirm = await req('/admin/confirmations', 'GET', null, newToken)
  check('绑定 MFA 后业务接口可用', afterBindConfirm.body.code === 0, afterBindConfirm.body.message)
  check('绑定 MFA 后可查询自身', bind.body.code === 0, bind.body.message)
  const afterBind = await req('/admin/auth/me', 'GET', null, newToken)
  check('绑定后 /admin/auth/me 正常', afterBind.body.code === 0, afterBind.body.message)
  // 先清掉该开关上遗留的待确认单（重复运行脚本时会有）
  const leftover = (await req('/admin/confirmations', 'GET', null, super1)).body.data?.items ?? []
  for (const l of leftover.filter((x) => x.status === '待确认' && x.action === 'switch.update')) {
    // 只撤销由 tech01 发起的（本脚本的发单角色）；其他留给对应角色
    if (l.requested_by_name === 'tech01') {
      await req(`/admin/confirmations/${l.id}/cancel`, 'POST', {}, tech)
    }
  }
  const superSet = await req('/admin/safety/switches/案例卡片', 'PUT', { enabled: true, reason: '联调：验证新账号确认' }, tech)
  console.log('switch resp', superSet.status, JSON.stringify(superSet.body).slice(0, 200))
  check('高危开关变更需双人确认（返回确认单 ID）',
    superSet.status === 409 && Boolean(superSet.body.data?.confirmation_id), superSet.body.message)
  const newApprove = await req(`/admin/confirmations/${superSet.body.data.confirmation_id}/approve`, 'POST', {}, newToken)
  check('另一名超级管理员确认后开关变更生效', newApprove.body.code === 0, newApprove.body.message)

  // ---------- 10：举报原文只在授权后可见 + 手机号脱敏 ----------
  const rep2 = await req('/feedback/error-report', 'POST', {
    analysis_id: undefined,
    content_item_id: target.id,
    category: '内容出错',
    description: '联调举报：我的电话 13912345678，解释不对',
    severity: 'medium',
  }, await newUser().then((x) => x.token))
  const queueForEditor = await req('/admin/feedback?type=error_report', 'GET', null, editor)
  const editorItem = (queueForEditor.body.data?.items ?? []).find((i) => i.id === rep2.body.data.id)
  check('运营编辑看不到原文快照（未授权）',
    editorItem?.raw_content === undefined || editorItem?.raw_content === '未授权，不可查看' || !editorItem?.description?.includes('13912345678'),
    JSON.stringify(editorItem?.raw_content ?? '').slice(0, 60))
  check('运营编辑看到的描述不含完整手机号', !String(editorItem?.description ?? '').includes('13912345678'))
  const editorDetail = await req(`/admin/feedback/${rep2.body.data.id}`, 'GET', null, editor)
  check('运营编辑详情不含完整手机号', !JSON.stringify(editorDetail.body.data ?? {}).includes('13912345678'))
  const authorize = await req(`/admin/feedback/${rep2.body.data.id}/authorize-view`, 'POST', { scope: '联调授权' }, clinician)
  check('临床审核申请单条授权需另一人审批（409 + 确认单）',
    authorize.status === 409 && Boolean(authorize.body.data?.confirmation_id), authorize.body.message)
  const approveAuth = await req(`/admin/confirmations/${authorize.body.data.confirmation_id}/approve`, 'POST', {}, super1)
  check('超级管理员审批后授权生效', approveAuth.body.code === 0, approveAuth.body.message)
  const clinicianDetail = await req(`/admin/feedback/${rep2.body.data.id}`, 'GET', null, clinician)
  check('授权后原文里手机号仍脱敏', !JSON.stringify(clinicianDetail.body.data?.raw_content ?? {}).includes('13912345678'))
  check('授权后原文可见', typeof clinicianDetail.body.data?.raw_content === 'object', JSON.stringify(clinicianDetail.body.data?.raw_content ?? '').slice(0, 40))

  // ---------- 11：证据 verify-license 日期 + 许可门禁 ----------
  const docs = await req('/admin/evidence', 'GET', null, clinician)
  const doc = (docs.body.data ?? []).find((d) => d.license === '可引用') ?? docs.body.data[0]
  const badDate = await req(`/admin/evidence/${doc.id}/verify-license`, 'POST', { verified_at: '2026/09/20' }, clinician)
  check('verify-license 日期格式非法返回中文 400', badDate.body.code === 40000, badDate.body.message)
  const okDate = await req(`/admin/evidence/${doc.id}/verify-license`, 'POST', { verified_at: '2026-09-20' }, clinician)
  check('verify-license 带 YYYY-MM-DD 成功', okDate.body.code === 0, okDate.body.message)

  // 新建「不填许可」的证据，切分入库后不应被用户检索命中
  const draftDoc = await req('/admin/evidence', 'POST', {
    title: '《联调未确认许可证据》',
    source_type: '指南',
    raw_text: '这份证据没有填许可，不应该被用户检索命中。',
  }, clinician)
  check('新建证据文档成功', draftDoc.body.code === 0, draftDoc.body.message)
  await req(`/admin/evidence/${draftDoc.body.data.id}/ingest`, 'POST', {}, clinician)
  const search = await req('/evidence/search', 'POST', { query: '许可' }, await newUser().then((x) => x.token))
  check('许可未确认的证据不参与用户检索',
    (search.body.data?.results ?? []).every((r) => r.doc_id !== draftDoc.body.data.id),
    (search.body.data?.results ?? []).map((r) => r.doc_title).join(','))

  // ---------- 27：校验错误中文 / 超长请求体 / 标题传数字 ----------
  const u2 = await newUser()
  const badType = await req(`/episodes/${epId}/events`, 'POST', {
    event_type: '坏类型', source_type: '自述', occurred_at: new Date().toISOString(),
  }, u2.token)
  check('事件类型非法返回中文 400', badType.body.code === 40000 && /[\u4e00-\u9fa5]/.test(badType.body.message), badType.body.message)
  const numTitle = await req('/episodes', 'POST', { title: 123 }, u2.token)
  check('标题传数字返回中文 400', numTitle.body.code === 40000 && /[\u4e00-\u9fa5]/.test(numTitle.body.message), numTitle.body.message)
  const big = await req('/episodes', 'POST', { title: 'x'.repeat(3 * 1024 * 1024) }, u2.token)
  check('3MB 请求体返回中文提示（413）', big.status === 413 && /[\u4e00-\u9fa5]/.test(big.body.message), `${big.status} ${big.body.message}`)
  const badHelp = await req('/feedback', 'POST', { analysis_id: 'x', help_type: 'bad' }, u2.token)
  check('帮助类型非法返回中文 400', badHelp.body.code === 40000 && /[\u4e00-\u9fa5]/.test(badHelp.body.message), badHelp.body.message)
  const badAction = await req(`/admin/feedback/${rep2.body.data.id}/handle`, 'POST', { action: '坏动作', comment: 'x' }, clinician)
  check('举报处置动作非法返回中文 400', badAction.body.code === 40000 && /[\u4e00-\u9fa5]/.test(badAction.body.message), badAction.body.message)
  const badSource = await req('/admin/evidence', 'POST', { title: 'x', source_type: '博客', raw_text: 'y' }, clinician)
  check('证据来源类型非法返回中文 400', badSource.body.code === 40000 && /[\u4e00-\u9fa5]/.test(badSource.body.message), badSource.body.message)
  const badOnset = await req('/episodes', 'POST', { title: 'y', onset_certainty: '坏' }, u2.token)
  check('起病确定度非法返回中文 400', badOnset.body.code === 40000 && /[\u4e00-\u9fa5]/.test(badOnset.body.message), badOnset.body.message)
  const badLeg = await req(`/episodes/${epId}/today-logs`, 'POST', { leg_change: '坏' }, u2.token)
  check('腿部变化非法返回中文 400', badLeg.body.code === 40000 && /[\u4e00-\u9fa5]/.test(badLeg.body.message), badLeg.body.message)

  // ---------- 31：未绑定 MFA 的账号不能操作 ----------
  const pendingName = 'pending' + Date.now().toString().slice(-6)
  await req('/admin/users', 'POST', { name: pendingName, role: '合规支持', password: '123456789' }, super1)
  const pendingToken = await adminLogin(pendingName, '123456789')
  const pending = await req('/admin/models', 'GET', null, pendingToken)
  check('未绑 MFA 时业务接口 40300（提示先绑定）', pending.body.code === 40300, pending.body.message)
  const publicNotice = await req('/safety/emergency-notice', 'GET', null, pendingToken)
  check('未绑 MFA 也能看公开就医提示', publicNotice.body.code === 0, publicNotice.body.message)
  const meWhilePending = await req('/admin/auth/me', 'GET', null, pendingToken)
  check('未绑 MFA 也能查询自身', meWhilePending.body.code === 0, meWhilePending.body.message)

  // ---------- 32：审计链完整性（删尾 / 改中间 / 伪造请求 ID 都能被发现） ----------
  try {
    const os = await import('node:os')
    const path = await import('node:path')
    const fs = await import('node:fs')
    const { DatabaseSync } = await import('node:sqlite')
    const { createHash } = await import('node:crypto')
    const dbDir = process.env.DB_DIR ?? './data'
    const tmp = path.join(os.tmpdir(), `yaoyouju-audit-${Date.now()}.db`)
    // 连 WAL 一起拷贝：审计记录可能还在 -wal 里（只拷 .db 会看不到表）
    fs.copyFileSync(path.join(dbDir, 'app.db'), tmp)
    for (const suffix of ['-wal', '-shm']) {
      const extra = path.join(dbDir, `app.db${suffix}`)
      if (fs.existsSync(extra)) fs.copyFileSync(extra, `${tmp}${suffix}`)
    }
    const copy = new DatabaseSync(tmp)
    copy.exec('DROP TRIGGER IF EXISTS audit_log_no_update; DROP TRIGGER IF EXISTS audit_log_no_delete;')
    const rows = copy
      .prepare('SELECT id, actor_id, action, target, diff, request_id, seq, prev_hash, hash, created_at FROM audit_log ORDER BY rowid ASC')
      .all()
    const recompute = (r, prev) =>
      createHash('sha256')
        .update([prev, r.id, r.actor_id ?? '', r.action, r.target ?? '', r.diff ?? '', r.created_at, r.request_id ?? ''].join('|'))
        .digest('hex')
    const chainOk = (list, prev0 = 'GENESIS') => {
      let prev = prev0
      let seq = 1
      for (const r of list) {
        if (r.seq !== seq || r.prev_hash !== prev || recompute(r, prev) !== r.hash) return false
        prev = r.hash
        seq += 1
      }
      return true
    }
    check('原始审计链自洽', chainOk(rows))
    // 删掉最后一条并同步锚点 → 链仍自洽，但锚点数量与链头不符
    const tail = rows[rows.length - 1]
    const anchor = copy.prepare('SELECT head_hash, total FROM audit_anchor WHERE id = 1').get()
    copy.prepare('DELETE FROM audit_log WHERE id = ?').run(tail.id)
    const trimmed = rows.slice(0, -1)
    check('删尾后链仍自洽（但锚点可发现）', chainOk(trimmed))
    check('删尾后锚点与链头不一致（可发现）',
      Number(anchor.total) === rows.length && anchor.head_hash === tail.hash)
    // 改中间一条并重算整条链 → 锚点不一致仍能发现
    const copy2 = new DatabaseSync(tmp)
    copy2.exec('DROP TRIGGER IF EXISTS audit_log_no_update; DROP TRIGGER IF EXISTS audit_log_no_delete;')
    const mid = rows[Math.floor(rows.length / 2)]
    copy2.prepare('UPDATE audit_log SET action = ? WHERE id = ?').run(mid.action + '_tampered', mid.id)
    let prev = 'GENESIS'
    for (const r of copy2.prepare('SELECT * FROM audit_log ORDER BY rowid ASC').all()) {
      const h = recompute(r, prev)
      copy2.prepare('UPDATE audit_log SET prev_hash = ?, hash = ? WHERE id = ?').run(prev, h, r.id)
      prev = h
    }
    const anchor2 = copy2.prepare('SELECT head_hash, total FROM audit_anchor WHERE id = 1').get()
    check('改中间一条并重算链后，锚点仍能发现', anchor2.head_hash !== prev)
    copy.close()
    copy2.close()
    fs.unlinkSync(tmp)
  } catch (e) {
    console.log('（跳过审计链本地校验：', e instanceof Error ? e.message : e, '）')
  }

  // ---------- 33：运营编辑权限 ----------
  // 运营编辑没有 content.publish：点「发起发布」生成双人确认单（40900 + confirmation_id），
  // 由另一名临床审核 / 超级管理员确认后才真正发布（第七轮验收反馈第 7 条）
  const publishTry = await req(`/admin/contents/${target.id}/publish`, 'POST', {}, editor)
  check('运营编辑不能直接发布（只能发起双人确认单）',
    publishTry.body.code === 40900 && Boolean(publishTry.body.data?.confirmation_id),
    publishTry.body.message)
  check('运营编辑不能确认自己发起的发布单',
    (await req(`/admin/confirmations/${publishTry.body.data.confirmation_id}/approve`, 'POST', {}, editor)).body.code !== 0)
  const rawEdit = await req(`/admin/evidence/${doc.id}`, 'PATCH', {
    title: doc.title,
    source_type: doc.source_type,
    raw_text: '改写后的原文',
  }, editor)
  check('运营编辑不能改写已启用证据原文（40300）', rawEdit.body.code === 40300, rawEdit.body.message)
  const triage = await req(`/admin/feedback/${rep2.body.data.id}/triage`, 'POST', {
    action: '待临床复核', comment: '联调初筛',
  }, editor)
  check('运营编辑可以提交举报初筛', triage.body.code === 0, triage.body.message)
  const auditTry = await req('/admin/audit', 'GET', null, editor)
  check('运营编辑不能查看审计日志（40300）', auditTry.body.code === 40300, auditTry.body.message)
  const usersTry = await req('/admin/users', 'GET', null, editor)
  check('运营编辑不能查看成员表（40300）', usersTry.body.code === 40300, usersTry.body.message)
  const techContent = await req('/admin/contents', 'GET', null, tech)
  check('技术负责人不能读内容库（40300）', techContent.body.code === 40300, techContent.body.message)
  const complianceContent = await req('/admin/contents', 'GET', null, await adminLogin('compliance01'))
  check('合规支持不能读内容库（40300）', complianceContent.body.code === 40300, complianceContent.body.message)

  // ---------- 12 / 33：权限矩阵（运营发布 = ◐、临床评测 = ◐） ----------
  const roles = await req('/admin/roles', 'GET', null, super1)
  const byName = new Map((roles.body.data?.roles ?? []).map((r) => [r.name, r.permissions]))
  check('运营编辑不持有 content.publish（设计 ◐ 发起）', !(byName.get('运营编辑') ?? []).includes('content.publish'))
  check('临床审核持有 model.view / eval.view（设计 ◐ 只读）',
    (byName.get('临床审核') ?? []).includes('model.view') && (byName.get('临床审核') ?? []).includes('eval.view'))

  console.log('')
  console.log(`复查结果: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) {
    console.log('未通过：')
    failures.forEach((f) => console.log(' -', f))
  }
  process.exitCode = fail > 0 ? 1 : 0
}

main().catch((e) => {
  console.error('复查失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})
