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
import { EpisodesService } from '../episodes/episodes.service';
import { SwitchesService } from '../switches/switches.service';
import { AuditService } from '../../common/audit.service';
import { ReportsController, EpisodeReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { extractTerms, SAMPLE_REPORT_TEXT } from './term-dict';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { APP_GUARD } from '@nestjs/core';

describe('T06 报告录入与结构化核对', () => {
  let app: INestApplication;
  let auth: AuthService;
  let episodes: EpisodesService;
  let reports: ReportsService;
  let switches: SwitchesService;
  let token: string;
  let episodeId: string;
  let dir: string;
  let me: { token: string; user: { id: string } };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-rp-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [ReportsController, EpisodeReportsController],
      providers: [
        AuthService,
        EpisodesService,
        ReportsService,
        SwitchesService,
        AuditService,
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
    episodes = app.get(EpisodesService);
    reports = app.get(ReportsService);
    switches = app.get(SwitchesService);
    me = auth.login('13800001234', '123456');
    token = me.token;
    episodeId = episodes.create(me.user.id, { title: '报告测试' }).id as string;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = () => ({ Authorization: `Bearer ${token}` });

  it('术语抽取：识别 L5/S1 等术语并记录原文位置', () => {
    const text = '腰椎 MRI：L5/S1 椎间盘轻度膨出，L4/L5 生理曲度变直。';
    const terms = extractTerms(text);
    const codes = terms.map((t) => t.term);
    expect(codes).toContain('L5/S1');
    expect(codes).toContain('L4/L5');
    expect(codes).toContain('生理曲度变直');
    for (const t of terms) {
      expect(text.slice(t.start, t.end)).toBe(t.term);
    }
    // 位置按出现顺序排列
    const starts = terms.map((t) => t.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    // 每个术语都有解释
    expect(terms.every((t) => t.meaning.length > 0)).toBe(true);
  });

  it('示例报告文本可抽取多个术语', () => {
    const terms = extractTerms(SAMPLE_REPORT_TEXT);
    expect(terms.length).toBeGreaterThanOrEqual(3);
  });

  it('录入报告：自动创建报告事件、记录来源与日期、带术语', async () => {
    const res = await api()
      .post('/reports')
      .set(H())
      .send({
        episode_id: episodeId,
        report_date: '2026-08-30',
        raw_text: SAMPLE_REPORT_TEXT,
        source_type: '报告原文',
      });
    expect(res.body.code).toBe(0);
    expect(res.body.data.report_date).toBe('2026-08-30');
    expect(res.body.data.source_type).toBe('报告原文');
    expect(res.body.data.extracted_terms.length).toBeGreaterThanOrEqual(3);
    expect(res.body.data.verify_status).toBe('尚未确认');

    const list = await api().get(`/episodes/${episodeId}/reports`).set(H());
    expect(list.body.data).toHaveLength(1);
  });

  it('空文本被拒绝', async () => {
    const res = await api().post('/reports').set(H()).send({ episode_id: episodeId, raw_text: '   ' });
    expect(res.body.code).toBe(40000);
  });

  it('拍照提取为模拟 OCR，且受开关控制', async () => {
    const off = await api().post('/reports/ocr').set(H());
    expect(off.body.code).toBe(50300);
    expect(off.body.message).toContain('请直接粘贴报告文字');

    switches.setEnabled('拍照提取', true, '演示：开启', null);
    const on = await api().post('/reports/ocr').set(H());
    expect(on.body.code).toBe(0);
    expect(on.body.data.simulated).toBe(true);
    expect(on.body.data.text).toContain('L5/S1');
    switches.setEnabled('拍照提取', false, '演示：关闭', null);
  });

  it('结构化核对：返回来源 / 时间 / 核实状态，冲突项需确认', async () => {
    const res = await api().get(`/episodes/${episodeId}/structured`).set(H());
    expect(res.body.code).toBe(0);
    const reportItem = res.body.data.items.find((i: { report: unknown }) => i.report);
    expect(reportItem.source_type).toBe('报告原文');
    expect(reportItem.verify_status).toBe('尚未确认');
    expect(reportItem.needs_confirm).toBe(false);
    expect(res.body.data.summary.total).toBeGreaterThanOrEqual(1);
  });

  it('纠正已确认事件为冲突后，核对接口标记需确认', async () => {
    const ev = episodes.addEvent(me.user.id, episodeId, {
      event_type: '症状',
      source_type: '自述',
      occurred_at: '2026-09-01',
      raw_text: '原文A',
      verify_status: '已确认',
    });
    episodes.correctEvent(me.user.id, episodeId, ev.id, {
      raw_text: '原文B',
    });
    const res = await api().get(`/episodes/${episodeId}/structured`).set(H());
    const item = res.body.data.items.find((i: { care_event_id: string }) => i.care_event_id === ev.id);
    expect(item.verify_status).toBe('有冲突');
    expect(item.needs_confirm).toBe(true);
    expect(res.body.data.summary.conflict).toBe(1);
  });

  it('访问他人报告返回 404', async () => {
    const other = auth.login('13900005678', '123456').token;
    const res = await api().get(`/episodes/${episodeId}/reports`).set({ Authorization: `Bearer ${other}` });
    expect(res.body.code).toBe(40400);
  });

  it('DbService 可解析（回归）', () => {
    expect(app.get(DbService)).toBeDefined();
  });
});
