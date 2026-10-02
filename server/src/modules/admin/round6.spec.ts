import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { AuthGuard } from '../../common/auth.guard';
import { AdminGuard } from '../../common/admin.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { hashAdminPassword } from '../../common/password';
import { AdminAuthController } from '../admin/admin-auth.controller';
import { AdminUsersController } from '../admin/admin-users.controller';
import { AdminAuditController } from '../admin/admin-audit.controller';
import { AdminConfirmationsController } from '../admin/admin-confirmations.controller';
import { AdminSafetyController } from '../admin/admin-safety.controller';
import { AdminAuthService } from '../admin/admin-auth.service';
import { AdminUsersService } from '../admin/admin-users.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import { ConfirmationService } from '../admin/confirmation.service';
import { ConfirmationExecutor } from '../admin/confirmation.executor';
import { PermissionGuard } from '../admin/permission.guard';
import { SwitchesService } from '../switches/switches.service';
import { AuthService } from '../auth/auth.service';
import { AuthController } from '../auth/auth.controller';
import { DualControlService } from '../admin/dual-control.service';
import { ContentsService } from '../contents/contents.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ModelReleasesService } from '../models/models.service';
import { EvalService } from '../models/eval.service';

/**
 * 第六轮验收反馈的回归用例（只覆盖本轮改动的规则）：
 * - 双人确认不能由同一个人邀请的账号完成（含同根邀请）；
 * - 只有一名超级管理员时，邀请第二名超管可由合规支持确认；
 * - 审计导出下载绑定申请人本人、只能下载一次；
 * - 审计锚点流水账能发现「删尾记录 + 把锚点换回旧值」。
 */
describe('第六轮反馈回归（双人确认同根 / 导出绑定 / 锚点流水账）', () => {
  let app: INestApplication;
  let db: DbService;
  let dir: string;
  const demoPassword = randomUUID();
  const totpCode = '123456';
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-r6-'));
    process.env.DB_DIR = dir;
    process.env.ADMIN_TOTP_DEMO_CODE = totpCode;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [
        AdminAuthController,
        AdminUsersController,
        AdminAuditController,
        AdminConfirmationsController,
        AdminSafetyController,
        AuthController,
      ],
      providers: [
        AdminAuthService,
        AdminUsersService,
        AdminAuditService,
        ConfirmationService,
        ConfirmationExecutor,
        SwitchesService,
        AuthService,
        AuditService,
        DualControlService,
        ContentsService,
        FeedbackService,
        ModelReleasesService,
        EvalService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: AdminGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DbService);
    db.app.prepare('UPDATE admin_user SET password_hash = ?').run(hashAdminPassword(demoPassword));
    for (const name of ['editor01', 'clinician01', 'tech01', 'compliance01', 'super01']) {
      const res = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ name, password: demoPassword, totp: totpCode });
      tokens[name] = (res.body.data as { token: string }).token;
      await request(app.getHttpServer())
        .post('/admin/auth/bind-mfa')
        .set({ Authorization: `Bearer ${tokens[name]}` })
        .send({ totp: totpCode });
    }
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });

  it('同一个人邀请的两个账号不能互相确认（含同根邀请）', async () => {
    const stamp = randomUUID().slice(0, 6);
    const techName = `tech${stamp}`;
    const clinName = `clin${stamp}`;
    for (const [name, role] of [[techName, '技术负责人'], [clinName, '临床审核']] as [string, string][]) {
      const res = await api().post('/admin/users').set(H('super01')).send({ name, role, password: demoPassword });
      expect(res.body.code).toBe(0);
      const loginRes = await api().post('/admin/auth/login').send({ name, password: demoPassword, totp: totpCode });
      await api()
        .post('/admin/auth/bind-mfa')
        .set({ Authorization: `Bearer ${loginRes.body.data.token}` })
        .send({ totp: totpCode });
      tokens[name] = loginRes.body.data.token;
    }
    // 自建技术账号发起高危开关变更
    const init = await api()
      .put('/admin/safety/switches/个性化分析')
      .set(H(techName))
      .send({ enabled: false, reason: '同根账号互相确认测试' });
    expect(init.body.code).toBe(40900);
    const confirmationId = init.body.data.confirmation_id as string;
    expect(confirmationId).toBeTruthy();
    // 自建临床账号确认 → 必须被拒
    const approve = await api().post(`/admin/confirmations/${confirmationId}/approve`).set(H(clinName)).send({});
    expect(approve.body.code).toBe(40300);
    expect(String(approve.body.message)).toContain('邀请创建关系');
    // 开关未被改动
    const switches = await api().get('/admin/safety/switches').set(H('super01'));
    const item = (switches.body.data as { key: string; enabled: boolean }[]).find((s) => s.key === '个性化分析');
    expect(item?.enabled).toBe(true);
  });

  it('只有一名超级管理员时，邀请第二名超管可由合规支持确认', async () => {
    const name = `super${randomUUID().slice(0, 6)}`;
    const init = await api().post('/admin/users').set(H('super01')).send({ name, role: '超级管理员', password: demoPassword });
    expect(init.body.code).toBe(40900);
    const confirmationId = init.body.data.confirmation_id as string;
    const approve = await api().post(`/admin/confirmations/${confirmationId}/approve`).set(H('compliance01')).send({});
    expect(approve.body.code).toBe(0);
    const users = await api().get('/admin/users').set(H('super01'));
    expect((users.body.data as { name: string }[]).some((u) => u.name === name)).toBe(true);
  });

  it('审计导出只能由申请人本人下载一次', async () => {
    const req = await api().post('/admin/audit/export-request').set(H('compliance01')).send({ reason: '回归用例' });
    expect(req.body.code).toBe(0);
    const requestId = (req.body.data as { id: string }).id;
    const approve = await api().post('/admin/audit/export-approve').set(H('super01')).send({ request_id: requestId });
    expect(approve.body.code).toBe(0);
    // 审批人（超管）不能顶替申请人下载
    const byApprover = await api().get(`/admin/audit/export?request_id=${requestId}`).set(H('super01'));
    expect(byApprover.status).toBe(403);
    // 申请人本人可下载一次
    const first = await api().get(`/admin/audit/export?request_id=${requestId}`).set(H('compliance01'));
    expect(first.status).toBe(200);
    // 不能重复下载
    const second = await api().get(`/admin/audit/export?request_id=${requestId}`).set(H('compliance01'));
    expect(second.status).toBe(409);
  });

  it('锚点流水账能发现「删尾记录 + 把锚点换回旧值」', () => {
    const audit = app.get(AuditService);
    const before = db.app
      .prepare('SELECT head_hash, head_hmac, total FROM audit_anchor WHERE id = 1')
      .get() as { head_hash: string; head_hmac: string; total: number };
    const beforeCount = (db.app.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
    // 新产生几条审计
    audit.append(null, 'r6.test.append', 'audit_log:test', { n: 1 });
    audit.append(null, 'r6.test.append', 'audit_log:test', { n: 2 });
    expect(audit.verifyChain().ok).toBe(true);
    // 模拟攻击者直接改库：绕过只追加触发器，删掉新增的尾记录
    db.app.exec('DROP TRIGGER IF EXISTS audit_log_no_delete');
    db.app.prepare('DELETE FROM audit_log WHERE rowid > ?').run(beforeCount);
    // 把锚点三个字段整体换回旧值（攻击者手里有旧锚点的完整内容）
    db.app
      .prepare('UPDATE audit_anchor SET head_hash = ?, head_hmac = ?, total = ? WHERE id = 1')
      .run(before.head_hash, before.head_hmac, before.total);
    const result = audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(String(result.reason)).toContain('流水账');
  });
});
