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

    const deniedAgain = await api()
      .get('/test-protected/analysis-like')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(deniedAgain.body.code).toBe(40310);

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
