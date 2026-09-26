import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { AUDIT_LOG_TRIGGERS } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { AuthController } from '../auth/auth.controller';
import { ModelsController } from '../models/models.controller';
import { ModelReleasesService } from '../models/models.service';
import { EvalService } from '../models/eval.service';
import { AuditService } from '../../common/audit.service';
import { AuthGuard } from '../../common/auth.guard';
import { AdminGuard } from '../../common/admin.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { hashAdminPassword } from '../../common/password';
import { AdminAuthController } from './admin-auth.controller';
import { AdminRolesController } from './admin-roles.controller';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuthorizationsController } from './admin-authorizations.controller';
import { AdminDualControlController } from './dual-control.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuditService, AuditLogItem, AuditExportRequest } from './admin-audit.service';
import { DualControlService } from './dual-control.service';
import { PermissionGuard } from './permission.guard';

/**
 * T14 后台账号、权限与审计。
 * 演示口令与 TOTP 均在运行时生成 / 从环境变量读取，不在代码中保存明文。
 */
describe('T14 后台账号、权限与审计（登录锁定 / 权限矩阵 / 双人确认 / 审计只追加）', () => {
  let app: INestApplication;
  let db: DbService;
  let dir: string;
  /** 运行时生成的后台演示口令（覆盖种子哈希，避免在代码中出现明文） */
  const demoPassword = randomUUID();
  /** 运行时生成的 TOTP 演示码（写入环境变量，服务端同一处读取） */
  const totpCode = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  const wrongTotp = totpCode === '000000' ? '111111' : '000000';

  const tokens: Record<string, string> = {};
  const adminIds: Record<string, string> = {};

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-admin-'));
    process.env.DB_DIR = dir;
    process.env.ADMIN_TOTP_DEMO_CODE = totpCode;

    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [
        AdminAuthController,
        AdminRolesController,
        AdminAuditController,
        AdminAuthorizationsController,
        AdminDualControlController,
        AuthController,
        ModelsController,
      ],
      providers: [
        AdminAuthService,
        AdminAuditService,
        DualControlService,
        AuthService,
        ModelReleasesService,
        EvalService,
        AuditService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: AdminGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    db = app.get(DbService);
    // 用运行时生成的口令覆盖种子口令哈希（登录仍走 sha256('yaoyouju:' + 口令) 比较）
    db.app.prepare('UPDATE admin_user SET password_hash = ?').run(hashAdminPassword(demoPassword));
    for (const name of ['editor01', 'clinician01', 'tech01', 'compliance01', 'super01']) {
      adminIds[name] = (
        db.app.prepare('SELECT id FROM admin_user WHERE name = ?').get(name) as { id: string }
      ).id;
    }
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (name: string, password = demoPassword, totp = totpCode) =>
    api().post('/admin/auth/login').send({ name, password, totp });
  const auditRows = (action: string) =>
    db.app.prepare('SELECT actor_id, action, target, diff FROM audit_log WHERE action = ? ORDER BY created_at ASC').all(action) as {
      actor_id: string | null;
      action: string;
      target: string;
      diff: string;
    }[];

  /** 依次登录五个角色，返回各自令牌 */
  async function loginAll(): Promise<void> {
    for (const name of ['editor01', 'clinician01', 'tech01', 'compliance01', 'super01']) {
      const res = await login(name);
      expect(res.body.code).toBe(0);
      tokens[name] = (res.body.data as { token: string }).token;
    }
  }

  it('登录成功返回令牌 + 角色 + 姓名，/admin/auth/me 返回权限', async () => {
    await loginAll();
    const res = await login('editor01');
    expect(res.body.code).toBe(0);
    const data = res.body.data as {
      token: string;
      admin: { id: string; name: string; role: { id: string; name: string }; permissions: string[]; mfa_enabled: boolean };
    };
    expect(data.token.startsWith('av1.')).toBe(true);
    expect(data.admin.name).toBe('editor01');
    expect(data.admin.role.name).toBe('运营编辑');
    expect(data.admin.permissions).toEqual(['content.draft', 'content.submit']);
    expect(data.admin.mfa_enabled).toBe(true);

    const me = await api().get('/admin/auth/me').set(H(tokens.editor01));
    expect(me.body.code).toBe(0);
    expect((me.body.data as { role: { name: string } }).role.name).toBe('运营编辑');
    expect((me.body.data as { permissions: string[] }).permissions).toContain('content.submit');

    // 登录成功写审计（记录操作人与角色，不记录口令 / 验证码）
    const logs = auditRows('admin.login').filter((l) => l.target === `admin_user:${adminIds.editor01}`);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].actor_id).toBe(adminIds.editor01);
    expect(JSON.stringify(logs)).not.toContain(demoPassword);
  });

  it('口令错误 / TOTP 错误登录失败并写审计（只记录账号，不记录口令）', async () => {
    const badPassword = await login('editor01', `wrong-${randomUUID()}`);
    expect(badPassword.body.code).toBe(40100);
    const badTotp = await login('editor01', demoPassword, wrongTotp);
    expect(badTotp.body.code).toBe(40100);

    const failures = auditRows('admin.login_failed').filter((l) => l.target === 'admin_user:editor01');
    expect(failures.length).toBeGreaterThanOrEqual(2);
    const reasons = failures.map((f) => (JSON.parse(f.diff) as { reason: string }).reason);
    expect(reasons).toContain('口令错误');
    expect(reasons).toContain('验证码错误');
    // 不记录口令与验证码
    expect(JSON.stringify(failures)).not.toContain(demoPassword);
    expect(JSON.stringify(failures)).not.toContain(totpCode);

    // 不存在的账号：同样失败并记审计（不透露账号是否存在）
    const missing = await login('no-such-admin', demoPassword, totpCode);
    expect(missing.body.code).toBe(40100);
    expect(missing.body.message).toBe('账号、口令或验证码不正确，请重新输入');

    // 参数不合法（TOTP 不是 6 位数字）→ 40000
    const badFormat = await login('editor01', demoPassword, '12345');
    expect(badFormat.body.code).toBe(40000);
  });

  it('各角色越权访问被拒绝（40300）并写审计', async () => {
    // 运营编辑没有 model.manage
    const models = await api()
      .post('/admin/models')
      .set(H(tokens.editor01))
      .send({ model_name: '越权测试', prompt_version: 'prompt-x' });
    expect(models.body.code).toBe(40300);
    expect(models.body.message).toBe('没有权限执行该操作');

    // 技术没有 audit.view
    const audit = await api().get('/admin/audit').set(H(tokens.tech01));
    expect(audit.body.code).toBe(40300);

    // 技术没有 dual_control.manage
    const dual = await api().get('/admin/dual-control/settings').set(H(tokens.tech01));
    expect(dual.body.code).toBe(40300);

    // 运营编辑没有 consent.view（单条授权记录）
    const authorizations = await api().get('/admin/authorizations').set(H(tokens.editor01));
    expect(authorizations.body.code).toBe(40300);

    // 运营编辑没有 audit.export（导出申请）
    const exportReq = await api()
      .post('/admin/audit/export-request')
      .set(H(tokens.editor01))
      .send({ reason: '越权导出测试' });
    expect(exportReq.body.code).toBe(40300);

    // 越权写审计（admin.permission_denied）
    const denials = auditRows('admin.permission_denied');
    expect(denials.length).toBeGreaterThanOrEqual(4);
    const latest = denials[denials.length - 1];
    expect(latest.actor_id).toBe(adminIds.editor01);
    expect((JSON.parse(latest.diff) as { permission: string }).permission).toBe('audit.export');
    expect(JSON.stringify(denials)).not.toContain(demoPassword);
  });

  it('角色权限矩阵：五个角色与权限列表（B10）', async () => {
    const res = await api().get('/admin/roles').set(H(tokens.super01));
    expect(res.body.code).toBe(0);
    const data = res.body.data as {
      roles: { id: string; name: string; permissions: string[] }[];
      catalog: { code: string; label: string }[];
    };
    expect(data.roles.map((r) => r.name)).toEqual([
      '运营编辑',
      '临床审核',
      '技术负责人',
      '合规支持',
      '超级管理员',
    ]);
    const byName = new Map(data.roles.map((r) => [r.name, r.permissions]));
    expect(byName.get('运营编辑')).toEqual(['content.draft', 'content.submit']);
    expect(byName.get('临床审核')).toEqual(['content.review', 'content.publish', 'content.offline']);
    expect(byName.get('技术负责人')).toEqual(['model.manage', 'eval.manage', 'switch.manage', 'evidence.manage']);
    expect(byName.get('合规支持')).toContain('audit.view');
    expect(byName.get('合规支持')).toContain('feedback.handle');
    expect(byName.get('超级管理员')).toEqual(['*']);
    expect(data.catalog.length).toBeGreaterThanOrEqual(15);
    expect(data.catalog.every((c) => c.code && c.label)).toBe(true);
  });

  it('审计日志：筛选（操作人 / 动作 / 时间范围）+ 分页', async () => {
    // 制造不同操作人的记录
    await api().post('/admin/auth/logout').set(H(tokens.compliance01));
    await api().post('/admin/auth/logout').set(H(tokens.super01));

    const byActor = await api().get('/admin/audit?actor=super01').set(H(tokens.compliance01));
    expect(byActor.body.code).toBe(0);
    const actorItems = (byActor.body.data as { items: AuditLogItem[]; total: number }).items;
    expect(actorItems.length).toBeGreaterThanOrEqual(1);
    expect(actorItems.every((i) => i.actor_name === 'super01')).toBe(true);
    // 返回时间 / 操作人 / 角色 / 动作 / 对象 / 请求 ID / 哈希（按时间倒序，最新在前）
    const loginItem = actorItems.find((i) => i.action === 'admin.login')!;
    expect(loginItem).toBeTruthy();
    expect(loginItem.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(loginItem.target).toBe(`admin_user:${adminIds.super01}`);
    expect(loginItem.actor_role).toBe('超级管理员');
    expect(typeof loginItem.hash).toBe('string');
    const createdTimes = actorItems.map((i) => i.created_at);
    expect(createdTimes).toEqual([...createdTimes].sort().reverse());

    const byAction = await api().get('/admin/audit?action=admin.logout').set(H(tokens.super01));
    const actionItems = (byAction.body.data as { items: AuditLogItem[] }).items;
    expect(actionItems.length).toBeGreaterThanOrEqual(2);
    expect(actionItems.every((i) => i.action === 'admin.logout')).toBe(true);

    // 分页
    const page1 = await api().get('/admin/audit?page=1&page_size=2').set(H(tokens.super01));
    const page1Data = page1.body.data as { items: AuditLogItem[]; total: number; page: number; page_size: number };
    expect(page1Data.page).toBe(1);
    expect(page1Data.page_size).toBe(2);
    expect(page1Data.items.length).toBe(2);
    expect(page1Data.total).toBeGreaterThan(2);
    const page2 = await api().get('/admin/audit?page=2&page_size=2').set(H(tokens.super01));
    const page2Items = (page2.body.data as { items: AuditLogItem[] }).items;
    expect(page2Items[0].id).not.toBe(page1Data.items[0].id);

    // 时间范围：未来起点 / 过去终点都查不到；非法时间 40000
    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await api().get(`/admin/audit?from=${encodeURIComponent(future)}`).set(H(tokens.super01));
    expect((none.body.data as { total: number }).total).toBe(0);
    const past = await api().get('/admin/audit?to=2020-01-01T00:00:00.000Z').set(H(tokens.super01));
    expect((past.body.data as { total: number }).total).toBe(0);
    const bad = await api().get('/admin/audit?from=not-a-time').set(H(tokens.super01));
    expect(bad.body.code).toBe(40000);
  });

  it('哈希链校验：正常情况下返回 ok', async () => {
    const res = await api().get('/admin/audit/verify').set(H(tokens.compliance01));
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual({ ok: true, broken_at: null });
  });

  it('篡改一条审计记录后，校验接口能发现（先绕过数据库触发器再改写）', async () => {
    const target = db.app
      .prepare('SELECT id FROM audit_log ORDER BY created_at ASC, rowid ASC LIMIT 1')
      .get() as { id: string };
    // 模拟数据库层保护被绕过：先删触发器，再篡改 action
    db.app.exec('DROP TRIGGER audit_log_no_update');
    db.app.prepare('UPDATE audit_log SET action = ? WHERE id = ?').run('tampered.action', target.id);

    const res = await api().get('/admin/audit/verify').set(H(tokens.super01));
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual({ ok: false, broken_at: target.id });

    // 恢复触发器，保证后续用例仍在数据库层保护下
    db.app.exec(AUDIT_LOG_TRIGGERS);
  });

  it('审计日志只追加：数据库触发器拒绝 UPDATE 与 DELETE', () => {
    const id = (db.app.prepare('SELECT id FROM audit_log LIMIT 1').get() as { id: string }).id;
    expect(() => db.app.prepare('UPDATE audit_log SET action = ? WHERE id = ?').run('x', id)).toThrow(/只追加/);
    expect(() => db.app.prepare('DELETE FROM audit_log WHERE id = ?').run(id)).toThrow(/只追加/);
    // 插入不受影响（只追加）
    const before = (db.app.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
    app.get(AuditService).append(adminIds.super01, 'admin.test_append', 'admin_user:test', { ok: true });
    expect((db.app.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n).toBe(before + 1);
  });

  it('登出写审计；无自助注册接口', async () => {
    const res = await api().post('/admin/auth/logout').set(H(tokens.editor01));
    expect(res.body.code).toBe(0);
    const logs = auditRows('admin.logout').filter((l) => l.actor_id === adminIds.editor01);
    expect(logs.length).toBeGreaterThanOrEqual(1);

    // 没有注册接口：/admin/auth/register 不存在（404）
    const register = await api().post('/admin/auth/register').send({ name: 'x', password: 'y', totp: '123456' });
    expect(register.body.code).toBe(40400);
  });

  it('双人确认：设置读取 / 变更（写审计）与 check 复用', async () => {
    const before = await api().get('/admin/dual-control/settings').set(H(tokens.compliance01));
    expect(before.body.code).toBe(0);
    expect((before.body.data as { enabled: boolean }).enabled).toBe(true); // 默认开启

    const off = await api()
      .put('/admin/dual-control/settings')
      .set(H(tokens.compliance01))
      .send({ enabled: false, reason: '测试：临时关闭双人确认' });
    expect(off.body.code).toBe(0);
    expect((off.body.data as { enabled: boolean }).enabled).toBe(false);

    const back = await api()
      .put('/admin/dual-control/settings')
      .set(H(tokens.super01))
      .send({ enabled: true, reason: '测试：恢复双人确认' });
    expect(back.body.code).toBe(0);
    expect((back.body.data as { enabled: boolean }).enabled).toBe(true);

    // 未填原因 → 40000
    const noReason = await api()
      .put('/admin/dual-control/settings')
      .set(H(tokens.super01))
      .send({ enabled: true });
    expect(noReason.body.code).toBe(40000);

    // 变更写审计
    const changes = auditRows('dual_control.update');
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect((JSON.parse(changes[0].diff) as { key: string }).key).toBe('发布双人确认');

    // DualControlService.check：已审定内容的审核人是 clinician01
    const itemId = (
      db.app.prepare(`SELECT id FROM content_item WHERE current_status = '已审定' LIMIT 1`).get() as { id: string }
    ).id;
    const dual = app.get(DualControlService);
    const samePerson = dual.check(adminIds.clinician01, itemId, 'content.publish');
    expect(samePerson.required).toBe(true);
    expect(samePerson.confirmed).toBe(false);
    expect(samePerson.confirmed_by).toBe(adminIds.clinician01);
    expect(samePerson.message).toContain('双人确认');
    const otherPerson = dual.check(adminIds.super01, itemId, 'content.publish');
    expect(otherPerson.confirmed).toBe(true);
    // 关闭开关后不再要求确认
    dual.updateSettings(false, '测试：关闭后 check', adminIds.super01);
    expect(dual.check(adminIds.clinician01, itemId, 'content.publish').required).toBe(false);
    dual.updateSettings(true, '测试：恢复', adminIds.super01);
  });

  it('审计导出需审批：申请 → 本人不能审批 → 换人审批 → 不能重复审批', async () => {
    const requestRes = await api()
      .post('/admin/audit/export-request')
      .set(H(tokens.compliance01))
      .send({ reason: '季度合规审计导出' });
    expect(requestRes.body.code).toBe(0);
    const created = requestRes.body.data as AuditExportRequest;
    expect(created.status).toBe('待审批');
    expect(created.applicant_name).toBe('compliance01');

    // 空原因 → 40000
    const empty = await api().post('/admin/audit/export-request').set(H(tokens.compliance01)).send({ reason: '  ' });
    expect(empty.body.code).toBe(40000);

    // 本人审批 → 40900
    const self = await api()
      .post('/admin/audit/export-approve')
      .set(H(tokens.compliance01))
      .send({ request_id: created.id });
    expect(self.body.code).toBe(40900);

    // 超级管理审批 → 已批准
    const approved = await api()
      .post('/admin/audit/export-approve')
      .set(H(tokens.super01))
      .send({ request_id: created.id });
    expect(approved.body.code).toBe(0);
    const done = approved.body.data as AuditExportRequest;
    expect(done.status).toBe('已批准');
    expect(done.approver_name).toBe('super01');
    expect(done.approved_at).toBeTruthy();

    // 重复审批 → 40900；不存在 → 404
    const again = await api()
      .post('/admin/audit/export-approve')
      .set(H(tokens.super01))
      .send({ request_id: created.id });
    expect(again.body.code).toBe(40900);
    const missing = await api()
      .post('/admin/audit/export-approve')
      .set(H(tokens.super01))
      .send({ request_id: '00000000-0000-0000-0000-000000000000' });
    expect(missing.body.code).toBe(40400);

    // 申请与审批都写审计
    expect(auditRows('audit.export_request').length).toBeGreaterThanOrEqual(1);
    const approvals = auditRows('audit.export_approve');
    expect(approvals.length).toBeGreaterThanOrEqual(1);
    expect(approvals[approvals.length - 1].actor_id).toBe(adminIds.super01);
  });

  it('单条授权记录：从审计日志筛选 feedback.authorize_view', async () => {
    // T12 的 authorize-view 写 audit_log(action=feedback.authorize_view)，这里补一条演示记录
    app.get(AuditService).append(adminIds.compliance01, 'feedback.authorize_view', 'feedback:demo-feedback-id', {
      scope: '核对报告原文表述',
    });
    const res = await api().get('/admin/authorizations').set(H(tokens.compliance01));
    expect(res.body.code).toBe(0);
    const data = res.body.data as { items: AuditLogItem[]; total: number };
    expect(data.total).toBeGreaterThanOrEqual(1);
    const item = data.items[0];
    expect(item.action).toBe('feedback.authorize_view');
    expect(item.actor_name).toBe('compliance01');
    expect(item.actor_role).toBe('合规支持');
    expect(item.target).toBe('feedback:demo-feedback-id');
    expect((item.diff as { scope: string }).scope).toBe('核对报告原文表述');
    expect(typeof item.hash).toBe('string');
  });

  it('连续失败 5 次锁定 15 分钟，锁定期间拒绝', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await login('clinician01', `wrong-${randomUUID()}`);
      expect(res.body.code).toBe(40100);
    }
    // 第 6 次：口令与验证码都正确也被锁定
    const locked = await login('clinician01');
    expect(locked.body.code).toBe(40300);
    expect(locked.body.message).toBe('账号已锁定，请稍后再试');

    // 锁定期间的尝试也写审计
    const lockLogs = auditRows('admin.login_failed').filter((l) => l.target === 'admin_user:clinician01');
    expect(lockLogs.some((l) => (JSON.parse(l.diff) as { reason: string }).reason === '账号已锁定')).toBe(true);
  });

  it('未登录访问 /admin 返回 40100；后台令牌与用户端令牌互不通用（隔离）', async () => {
    const audit = await api().get('/admin/audit');
    expect(audit.body.code).toBe(40100);
    const me = await api().get('/admin/auth/me');
    expect(me.body.code).toBe(40100);
    const settings = await api().get('/admin/dual-control/settings');
    expect(settings.body.code).toBe(40100);

    // 后台令牌访问用户端接口 → 40100
    const crossUser = await api().get('/auth/me').set(H(tokens.editor01));
    expect(crossUser.body.code).toBe(40100);

    // 用户端令牌访问后台接口 → 40100
    const userToken = (await api().post('/auth/login').send({ phone: '13800001234', code: '123456' })).body.data
      .token as string;
    const crossAdmin = await api().get('/admin/audit').set(H(userToken));
    expect(crossAdmin.body.code).toBe(40100);
  });
});
