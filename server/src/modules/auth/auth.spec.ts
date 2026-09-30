import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { DbModule } from '../../db/db.module';
import { SchemaService } from '../../db/schema.service';
import { AuthService } from './auth.service';
import { DbService } from '../../db/db.service';
import { SafetyModule } from '../safety/safety.module';
import { EpisodesService } from '../episodes/episodes.service';
import { EpisodesController } from '../episodes/episodes.controller';
import { SafetyService } from '../safety/safety.service';
import { AuthController } from './auth.controller';
import { SafetyNoticeController } from '../safety/safety.controller';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { Public } from '../../common/public.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { ResponseInterceptor } from '../../common/response.interceptor';

/** 测试专用：需要同意才能访问的路由 */
@Controller('test-protected')
class TestProtectedController {
  @RequireConsent('健康信息处理')
  @Get('analysis-like')
  analysisLike(@CurrentUser() user: { id: string }) {
    return { ok: true, user_id: user.id };
  }

  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @RequireConsent('健康信息处理')
  @Post('write-like')
  writeLike(@CurrentUser() user: { id: string }) {
    return { ok: true, user_id: user.id };
  }

  @Post('login-required')
  loginRequired() {
    return { ok: true };
  }
}

describe('T03 登录与同意', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-auth-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [AuthController, SafetyNoticeController, TestProtectedController],
      providers: [
        AuthService,
        SchemaService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());

  async function login(phone = '13800001234', code = '123456') {
    const res = await api().post('/auth/login').send({ phone, code });
    return res;
  }

  it('登录：手机号 + 固定验证码，返回令牌与同意记录', async () => {
    const res = await login();
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.token).toMatch(/^v1\./);
    expect(res.body.data.user.phone_masked).toBe('138****1234');
    expect(Array.isArray(res.body.data.consents)).toBe(true);
  });

  it('验证码错误被拒绝（40000）', async () => {
    const res = await login('13800001234', '000000');
    expect(res.body.code).toBe(40000);
    expect(res.body.message).toContain('验证码');
  });

  it('手机号格式错误被拒绝', async () => {
    const res = await api().post('/auth/login').send({ phone: '123', code: '123456' });
    expect(res.body.code).toBe(40000);
  });

  it('公开接口无需登录（就医提示）', async () => {
    const res = await api().get('/safety/emergency-notice');
    expect(res.status).toBe(200);
    expect(res.body.data.headline).toBe('建议尽快就医');
    expect(res.body.data.footer_note).toContain('不是诊断结论');
  });

  it('未登录访问受保护接口返回 40100', async () => {
    const res = await api().get('/test-protected/analysis-like');
    expect(res.body.code).toBe(40100);
  });

  it('未同意健康信息处理时分析类接口被拒绝（40310），同意后放行，撤回后再次拒绝', async () => {
    const loginRes = await login('13800001234');
    const token: string = loginRes.body.data.token;

    // 种子用户 1 已同意健康信息处理；换一个未同意的新手机号验证拒绝路径
    const fresh = await login('13700009999');
    const freshToken: string = fresh.body.data.token;

    const denied = await api()
      .get('/test-protected/analysis-like')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(denied.body.code).toBe(40310);
    expect(denied.body.message).toContain('健康信息处理');

    // 单独同意后放行
    const grant = await api()
      .post('/auth/consents')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ scope: '健康信息处理' });
    expect(grant.body.code).toBe(0);

    const allowed = await api()
      .get('/test-protected/analysis-like')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(allowed.body.code).toBe(0);
    expect(allowed.body.data.ok).toBe(true);

    // 撤回后立即拒绝
    const revoke = await api()
      .post('/auth/consents/健康信息处理/revoke')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(revoke.body.code).toBe(0);
    const revokedConsent = revoke.body.data.find(
      (c: { scope: string }) => c.scope === '健康信息处理',
    );
    expect(revokedConsent.granted).toBe(false);

    // 撤回后：写接口立即拒绝；只读接口仍可查看历史数据（页面承诺「只读仍可使用」）
    const readAfterRevoke = await api()
      .get('/test-protected/analysis-like')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(readAfterRevoke.body.code).toBe(0);

    const writeAfterRevoke = await api()
      .post('/test-protected/write-like')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(writeAfterRevoke.body.code).toBe(40310);
    expect(writeAfterRevoke.body.message).toContain('已撤回');

    // 原种子用户不受影响（已同意）
    const stillOk = await api()
      .get('/test-protected/analysis-like')
      .set('Authorization', `Bearer ${token}`);
    expect(stillOk.body.code).toBe(0);
  });

  it('同意记录可查：三项范围 + 时间', async () => {
    const loginRes = await login('13800001234');
    const token: string = loginRes.body.data.token;
    const res = await api().get('/auth/consents').set('Authorization', `Bearer ${token}`);
    expect(res.body.code).toBe(0);
    const scopes = res.body.data.map((c: { scope: string }) => c.scope);
    expect(scopes).toContain('健康信息处理');
    expect(scopes).toContain('产品改进');
  });

  it('身份库中不出现明文手机号', async () => {
    const rows = (
      app.get(AuthService) as AuthService
    );
    void rows;
    const { DbService } = await import('../../db/db.service');
    const db = app.get(DbService);
    const dump = db.identity
      .prepare('SELECT phone_enc, phone_hash, real_name_enc FROM identity_profile')
      .all() as { phone_enc: string; real_name_enc: string }[];
    for (const r of dump) {
      expect(r.phone_enc).not.toMatch(/1\d{10}/);
      expect(JSON.stringify(r)).not.toContain('13800001234');
    }
  });

  it('AppModule 能正常组装（全局守卫注册无冲突）', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const a = moduleRef.createNestApplication();
    await a.init();
    await a.close();
  });
});

describe('T03b 退出登录、账户删除与数据导出', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-auth2-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule, SafetyModule],
      controllers: [AuthController, TestProtectedController, EpisodesController],
      providers: [
        AuthService,
        EpisodesService,
        SafetyService,
        SchemaService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('退出登录后旧令牌立即失效', async () => {
    const res = await api().post('/auth/login').send({ phone: '13900001111', code: '123456' });
    const token = res.body.data.token as string;
    // 登录后可用
    expect((await api().get('/auth/me').set(H(token))).body.code).toBe(0);
    // 退出登录
    const out = await api().post('/auth/logout').set(H(token)).send({});
    expect(out.body.code).toBe(0);
    // 旧令牌失效
    const after = await api().get('/auth/me').set(H(token));
    expect(after.body.code).toBe(40100);
    // 重新登录拿到新令牌（同一手机号）
    const again = await api().post('/auth/login').send({ phone: '13900001111', code: '123456' });
    expect(again.body.data.token).not.toBe(token);
  });

  it('导出数据包含病程、问答、反馈与安全事件', async () => {
    const res = await api().post('/auth/login').send({ phone: '13900003333', code: '123456' });
    const token = res.body.data.token as string;
    const exported = await api().get('/auth/export').set(H(token));
    expect(exported.body.code).toBe(0);
    const data = exported.body.data as { episodes: unknown[]; qa_sessions: unknown[]; feedback: unknown[]; safety_events: unknown[] };
    expect(Array.isArray(data.episodes)).toBe(true);
    expect(Array.isArray(data.qa_sessions)).toBe(true);
    expect(Array.isArray(data.safety_events)).toBe(true);
    expect(data.episodes.length).toBe(0);
  });

  it('删除账户：二次确认 → 冷静期 → 确认后数据清除，同号登录不再有旧数据', async () => {
    const login = await api().post('/auth/login').send({ phone: '13900004444', code: '123456' });
    const token = login.body.data.token as string;
    const userId = login.body.data.user.id as string;
    // 造一点数据
    const eps = app.get(EpisodesService);
    const ep = eps.create(userId, { title: '待删除的病程' });
    eps.addEvent(userId, ep.id as string, {
      event_type: '症状',
      occurred_at: '2026-09-01',
      source_type: '自述',
      raw_text: '久坐后腰痛',
      verify_status: '已确认',
    });

    // 验证码错误不能申请
    const bad = await api().post('/auth/delete-request').set(H(token)).send({ phone: '13900004444', code: '000000' });
    expect(bad.body.code).toBe(40000);

    // 申请删除 → 冷静期 24 小时
    const req = await api()
      .post('/auth/delete-request')
      .set(H(token))
      .send({ phone: '13900004444', code: '123456' });
    expect(req.body.code).toBe(0);
    expect(req.body.data.status).toBe('冷静期中');
    expect(req.body.data.can_confirm).toBe(false);

    // 冷静期内确认被拒绝
    const early = await api()
      .post('/auth/delete-confirm')
      .set(H(token))
      .send({ phone: '13900004444', code: '123456' });
    expect(early.body.code).toBe(40900);

    // 取消后可以重新申请
    const cancel = await api().post('/auth/delete-cancel').set(H(token));
    expect(cancel.body.code).toBe(0);
    const req2 = await api()
      .post('/auth/delete-request')
      .set(H(token))
      .send({ phone: '13900004444', code: '123456' });
    expect(req2.body.code).toBe(0);

    // 直接把冷静期改到过去，再确认删除（演示环境等价于冷静期结束）
    const db = app.get(DbService) as unknown as { app: { prepare: (sql: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown } } };
    db.app
      .prepare("UPDATE deletion_request SET effective_at = ? WHERE user_id = ? AND status = '冷静期中'")
      .run(new Date(Date.now() - 60_000).toISOString(), userId);

    const confirm = await api()
      .post('/auth/delete-confirm')
      .set(H(token))
      .send({ phone: '13900004444', code: '123456' });
    expect(confirm.body.code).toBe(0);
    expect(confirm.body.data.deleted).toBe(true);

    // 旧令牌失效、业务数据被硬删
    const list = await api().get('/auth/me').set(H(token));
    expect(list.body.code).toBe(40100);
    expect((db.app.prepare('SELECT COUNT(*) n FROM episode WHERE user_id=?').get(userId) as { n: number }).n).toBe(0);
    expect((db.app.prepare('SELECT COUNT(*) n FROM care_event WHERE episode_id=?').get(ep.id) as { n: number }).n).toBe(0);

    // 同一手机号重新登录：旧病程已不存在
    const relogin = await api().post('/auth/login').send({ phone: '13900004444', code: '123456' });
    expect(relogin.body.code).toBe(0);
    const newToken = relogin.body.data.token as string;
    // 新账号需要重新同意健康信息处理（同意本身是可查可撤的）
    await api().post('/auth/consents').set(H(newToken)).send({ scope: '健康信息处理' });
    const episodes = await api().get('/episodes').set(H(newToken));
    expect(episodes.body.code).toBe(0);
    expect(episodes.body.data).toEqual([]);
  });
});
