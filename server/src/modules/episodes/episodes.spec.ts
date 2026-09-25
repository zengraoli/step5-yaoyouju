import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { SchemaService } from '../../db/schema.service';
import { AuthService } from '../auth/auth.service';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { APP_GUARD } from '@nestjs/core';

describe('T05 病程、病程事件与记录今天', () => {
  let app: INestApplication;
  let auth: AuthService;
  let db: DbService;
  let dir: string;
  let token: string;
  let episodeId: string;
  const otherToken = 'x';

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-ep-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [EpisodesController],
      providers: [
        AuthService,
        EpisodesService,
        SchemaService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    auth = app.get(AuthService);
    db = app.get(DbService);
    token = auth.login('13800001234', '123456').token;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const authHeader = (t = token) => ({ Authorization: `Bearer ${t}` });

  it('创建病程：起病时间可为空 = 尚未确认', async () => {
    const res = await api().post('/episodes').set(authHeader()).send({ title: '久坐后腰痛' });
    expect(res.body.code).toBe(0);
    episodeId = res.body.data.id;
    expect(res.body.data.onset_certainty).toBe('尚未确认');
    expect(res.body.data.onset_date).toBeNull();
  });

  it('添加五类事件与三种来源', async () => {
    for (const [event_type, source_type] of [
      ['症状', '自述'],
      ['报告', '报告原文'],
      ['医嘱', '医生记录'],
      ['行动', '自述'],
      ['结局', '医生记录'],
    ]) {
      const res = await api()
        .post(`/episodes/${episodeId}/events`)
        .set(authHeader())
        .send({ event_type, source_type, occurred_at: '2026-09-01', raw_text: `${event_type}原文` });
      expect(res.body.code).toBe(0);
      expect(res.body.data.verify_status).toBe('尚未确认');
    }
    const detail = await api().get(`/episodes/${episodeId}`).set(authHeader());
    expect(detail.body.data.events).toHaveLength(5);
  });

  it('记录今天：缺失字段返回「尚未确认」而不是空或「无」', async () => {
    const res = await api()
      .post(`/episodes/${episodeId}/today-logs`)
      .set(authHeader())
      .send({ sit_minutes: 30 });
    expect(res.body.code).toBe(0);
    const log = res.body.data;
    expect(log.sit_minutes).toBe(30);
    expect(log.sit_minutes_display).toContain('30');
    // 未填的字段
    expect(log.planned_activity_done).toBe('尚未确认');
    expect(log.top_worry).toBe('尚未确认');
    expect(log.leg_change).toBe('尚未确认');
    expect(log.sleep_impact_display).toBe('尚未确认');
    expect(JSON.stringify(log)).not.toContain('"无"');
  });

  it('允许跳过：跳过也生成一条记录，全部为尚未确认', async () => {
    const res = await api()
      .post(`/episodes/${episodeId}/today-logs`)
      .set(authHeader())
      .send({ skipped: true });
    expect(res.body.code).toBe(0);
    expect(res.body.data.sit_minutes_display).toBe('尚未确认');
    expect(res.body.data.leg_change).toBe('尚未确认');
  });

  it('todayStatus 返回今天是否已记录（不复用昨日答案）', async () => {
    const res = await api().get(`/episodes/${episodeId}/today`).set(authHeader());
    expect(res.body.code).toBe(0);
    expect(res.body.data.logged).toBe(true);
    expect(res.body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('时间线按日期分组，带来源与核实状态', async () => {
    const res = await api().get(`/episodes/${episodeId}/timeline`).set(authHeader());
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);
    const flat = res.body.data.flatMap((g: { events: unknown[] }) => g.events) as Record<string, string>[];
    expect(flat.length).toBeGreaterThanOrEqual(7);
    expect(flat.some((e) => e.source_type === '报告原文')).toBe(true);
    expect(flat.every((e) => ['已确认', '尚未确认', '有冲突'].includes(e.verify_status))).toBe(true);
  });

  it('用户可纠正自己的记录：已确认内容被修改后降级为「有冲突」', async () => {
    const created = await api()
      .post(`/episodes/${episodeId}/events`)
      .set(authHeader())
      .send({ event_type: '症状', source_type: '自述', occurred_at: '2026-09-02', raw_text: '原文A', verify_status: '已确认' });
    const eventId = created.body.data.id;
    const corrected = await api()
      .patch(`/episodes/${episodeId}/events/${eventId}`)
      .set(authHeader())
      .send({ raw_text: '原文B' });
    expect(corrected.body.code).toBe(0);
    expect(corrected.body.data.verify_status).toBe('有冲突');
    // 也可显式确认
    const confirmed = await api()
      .patch(`/episodes/${episodeId}/events/${eventId}`)
      .set(authHeader())
      .send({ verify_status: '已确认' });
    expect(confirmed.body.data.verify_status).toBe('已确认');
  });

  it('用户可删除自己的记录', async () => {
    const created = await api()
      .post(`/episodes/${episodeId}/events`)
      .set(authHeader())
      .send({ event_type: '行动', source_type: '自述', occurred_at: '2026-09-03', raw_text: '要删除' });
    const eventId = created.body.data.id;
    const del = await api().delete(`/episodes/${episodeId}/events/${eventId}`).set(authHeader());
    expect(del.body.data.deleted).toBe(true);
    const detail = await api().get(`/episodes/${episodeId}`).set(authHeader());
    expect(detail.body.data.events.find((e: { id: string }) => e.id === eventId)).toBeUndefined();
  });

  it('访问他人病程返回 404', async () => {
    const other = auth.login('13900005678', '123456').token;
    const res = await api().get(`/episodes/${episodeId}`).set(authHeader(other));
    expect(res.body.code).toBe(40400);
  });

  it('未登录 / 未同意健康信息处理被拒绝', async () => {
    const noAuth = await api().get('/episodes');
    expect(noAuth.body.code).toBe(40100);
    const fresh = auth.login('13700009999', '123456').token;
    const noConsent = await api().get('/episodes').set(authHeader(fresh));
    expect(noConsent.body.code).toBe(40310);
  });
});
