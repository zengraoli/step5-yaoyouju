import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

describe('健康检查（统一响应格式）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health 返回 { code: 0, data, message: "ok" }', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('ok');
    expect(res.body.data).toHaveProperty('status');
    expect(res.body.data.db).toBe('ok');
  });

  it('未知路径返回统一错误格式（40400 + 中文文案）', async () => {
    const res = await request(app.getHttpServer()).get('/__not_exist__').expect(404);
    expect(res.body.code).toBe(40400);
    expect(res.body.message).toBe('请求的内容不存在');
    expect(res.body.data).toBeNull();
  });
});
