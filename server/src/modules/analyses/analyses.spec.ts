import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { SchemaService } from '../../db/schema.service';
import { AuthService } from '../auth/auth.service';
import { EpisodesService } from '../episodes/episodes.service';
import { SwitchesService } from '../switches/switches.service';
import { AuditService } from '../../common/audit.service';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';
import { SafetyService } from '../safety/safety.service';
import { consumeOneTask } from './analysis-pipeline';
import { LocalMockAdapter, findSupport } from './model-adapter';
import { retrieveEvidence } from '../evidence/evidence-retrieval';

describe('T07 一页分析流水线与 Worker', () => {
  let app: INestApplication;
  let auth: AuthService;
  let episodes: EpisodesService;
  let switches: SwitchesService;
  let db: DbService;
  let token: string;
  let episodeId: string;
  let dir: string;
  let analysisId = '';

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-an-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [AnalysesController],
      providers: [
        AuthService,
        EpisodesService,
        AnalysesService,
        SafetyService,
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
    switches = app.get(SwitchesService);
    db = app.get(DbService);

    // 演示用户 u1（13800001234）已同意「健康信息处理」
    const me = auth.login('13800001234', '123456');
    token = me.token;
    const ep = episodes.create(me.user.id, { title: '久坐腰痛分析测试' });
    episodeId = ep.id as string;
    // 录入与证据库相关的病程内容（腰痛 / 久坐 / L5/S1）
    episodes.addEvent(me.user.id, episodeId, {
      event_type: '症状',
      occurred_at: '2026-09-01',
      source_type: '自述',
      raw_text: '久坐 4 小时后腰痛，起身活动可缓解',
      verify_status: '已确认',
    });
    episodes.addEvent(me.user.id, episodeId, {
      event_type: '报告',
      occurred_at: '2026-08-30',
      source_type: '报告原文',
      raw_text: '腰椎 MRI：L5/S1 椎间盘轻度膨出，报告未描述下肢肌力情况',
      verify_status: '已确认',
    });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = () => ({ Authorization: `Bearer ${token}` });
  const countTasks = () =>
    (db.app.prepare('SELECT COUNT(*) AS n FROM analysis_task').get() as { n: number }).n;

  it('命中红旗（high）：返回就医提示且不创建任务', async () => {
    const before = countTasks();
    const res = await api()
      .post('/analyses')
      .set(H())
      .send({ episode_id: episodeId, symptom_change: '这两天会阴部麻木，伴大小便控制变化' });
    expect(res.body.code).toBe(40911); // high → 停止个性化分析
    expect(res.body.data).toBeTruthy();
    expect(res.body.data.title).toBe('需要及时寻求专业帮助');
    expect(res.body.data.headline).toBe('建议尽快就医');
    // matched 规则带上
    expect(Array.isArray(res.body.data.matched)).toBe(true);
    expect(res.body.data.matched.length).toBeGreaterThan(0);
    expect(res.body.data.matched[0].rule_code).toBeTruthy();
    expect(res.body.data.matched[0].severity).toBe('high');
    expect(res.body.data.matched[0].excerpt).toBeTruthy();
    // 不创建任务
    expect(countTasks()).toBe(before);
    // 写入了安全事件
    const ev = db.app
      .prepare('SELECT COUNT(*) AS n FROM safety_event WHERE user_id=?')
      .get(auth.verifyToken(token)!.id) as { n: number };
    expect(ev.n).toBeGreaterThan(0);
  });

  it('命中 medium：创建任务并附安全提示', async () => {
    const before = countTasks();
    const res = await api()
      .post('/analyses')
      .set(H())
      .send({ episode_id: episodeId, symptom_change: '搬重物后腰痛加重' });
    expect(res.status).toBe(202);
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.safety_notice).toBeTruthy();
    expect(res.body.data.safety_notice.matched[0].severity).toBe('medium');
    expect(countTasks()).toBe(before + 1);
  });

  it('个性化分析开关关闭：返回回退结果，不创建任务', async () => {
    switches.setEnabled('个性化分析', false, '测试：关闭', null);
    const before = countTasks();
    const res = await api().post('/analyses').set(H()).send({ episode_id: episodeId });
    expect(res.body.code).toBe(0);
    expect(res.body.data.status).toBe('fallback');
    expect(res.body.data.fallback.meta.fallback).toBe(true);
    expect(res.body.data.fallback.meta.reason).toBe('switch_off');
    expect(res.body.data.fallback.meta.disclaimer).toContain('不作诊断');
    expect(res.body.data.fallback.explain).toEqual([]); // 回退不生成解释
    expect(countTasks()).toBe(before);
    switches.setEnabled('个性化分析', true, '测试：恢复', null);
  });

  it('正常提交：202 + 任务 ID；不启动 worker 显示 queued；consume 一次后完成且每条 explain 有 supported 来源', async () => {
    const res = await api()
      .post('/analyses')
      .set(H())
      .send({ episode_id: episodeId, question: '复查时需要重点看什么' });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('queued');
    const taskId = res.body.data.task_id as string;
    expect(taskId).toBeTruthy();

    // 不启动 Worker：任务保持排队
    const queued = await api().get(`/analyses/task/${taskId}`).set(H());
    expect(queued.body.data.status).toBe('queued');

    // 手动调用 worker 的 consume 函数（处理排队任务，含之前 medium 任务）
    let guard = 0;
    while (guard++ < 10) {
      const cur = await api().get(`/analyses/task/${taskId}`).set(H());
      if (cur.body.data.status !== 'queued') break;
      const r = consumeOneTask(db.app, new LocalMockAdapter());
      expect(r.processed).toBe(true);
    }

    const done = await api().get(`/analyses/task/${taskId}`).set(H());
    expect(done.body.data.status).toBe('completed');
    const analysis = done.body.data.analysis;
    analysisId = analysis.id as string;
    expect(analysis.sections.explain.length).toBeGreaterThan(0);
    for (const ex of analysis.sections.explain) {
      expect(ex.citations.length).toBeGreaterThan(0);
      for (const c of ex.citations) {
        expect(c.supported).toBe(true);
        expect(c.evidence_doc_id).toBeTruthy();
        expect(c.statement).toBeTruthy();
      }
    }
    // known 段带 care_event_id（前端可定位报告原文）
    expect(analysis.sections.known.length).toBeGreaterThan(0);
    expect(analysis.sections.known[0].care_event_id).toBeTruthy();
    // 版本号：取该 episode 现有最大 version + 1（medium 任务已生成 v1，故本次为 v2）
    const maxVer = db.app
      .prepare('SELECT MAX(version) AS v FROM analysis WHERE episode_id=?')
      .get(episodeId) as { v: number };
    expect(analysis.version).toBe(maxVer.v);
    expect(analysis.version).toBeGreaterThanOrEqual(1);
  });

  it('检索只在证据库内（引用均指向 evidence_doc，mock 不访问外部）', async () => {
    const analysis = await api().get(`/analyses/${analysisId}`).set(H());
    const sections = analysis.body.data.sections;
    for (const ex of sections.explain) {
      for (const c of ex.citations) {
        const doc = db.app.prepare('SELECT id FROM evidence_doc WHERE id=?').get(c.evidence_doc_id);
        expect(doc).toBeTruthy(); // 引用的证据文档确实存在于证据库
        // statement 能在证据片段中找到支撑
        const chunks = db.app
          .prepare('SELECT c.content FROM evidence_chunk c WHERE c.doc_id=?')
          .all(c.evidence_doc_id) as { content: string }[];
        const supported = chunks.some((ch) => findSupport(c.statement, [
          { chunk_id: '', doc_id: c.evidence_doc_id, doc_title: '', content: ch.content, score: 1 },
        ]));
        expect(supported).toBe(true);
      }
    }
    // 检索函数只查 evidence_chunk（本地库），不产生外部请求
    const ev = retrieveEvidence(db.app, '久坐 腰痛 L5/S1', 5);
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.every((e) => e.doc_id && e.content)).toBe(true);
  });

  it('GET /analyses/{id} 返回五段结构 + disclaimer + 模型版本 + 检索快照', async () => {
    const res = await api().get(`/analyses/${analysisId}`).set(H());
    expect(res.body.code).toBe(0);
    const s = res.body.data.sections;
    expect(s).toHaveProperty('known');
    expect(s).toHaveProperty('explain');
    expect(s).toHaveProperty('unknown');
    expect(s).toHaveProperty('next');
    expect(s).toHaveProperty('videos');
    // 缺失信息显示「尚未确认」而非结论
    expect(s.unknown.some((u: string) => u.includes('尚未确认') || u.includes('报告未提及'))).toBe(true);
    // meta：模型版本、检索快照、disclaimer
    expect(s.meta.model_release).toBeTruthy();
    expect(s.meta.retrieval_snapshot).toBeTruthy();
    expect(s.meta.retrieval_snapshot.strategy).toBeTruthy();
    expect(res.body.data.disclaimer).toContain('系统生成内容');
    expect(res.body.data.disclaimer).toContain('不作诊断');
    expect(res.body.data.model_release_id).toBeTruthy();
  });

  it('访问他人分析返回 404', async () => {
    const other = auth.login('13900005678', '123456').token;
    const res = await api().get(`/analyses/${analysisId}`).set({ Authorization: `Bearer ${other}` });
    expect(res.body.code).toBe(40400);
  });

  it('未同意健康信息处理时返回 40310', async () => {
    const phone = '13700000099';
    const fresh = auth.login(phone, '123456'); // 新用户，无同意
    const ep = episodes.create(fresh.user.id, { title: '无同意测试' });
    const res = await api()
      .post('/analyses')
      .set({ Authorization: `Bearer ${fresh.token}` })
      .send({ episode_id: ep.id });
    expect(res.body.code).toBe(40310);
  });

  it('verifyStatements 剔除无依据陈述', () => {
    const adapter = new LocalMockAdapter();
    const evidence = [
      { chunk_id: 'c1', doc_id: 'd1', doc_title: '文档一', content: 'L5/S1 是腰椎与骶椎之间的椎间盘。', score: 3 },
    ];
    const draft = {
      known: [],
      explain: [
        { text: 'L5/S1 是腰椎与骶椎之间的椎间盘。', citations: [{ evidence_doc_id: 'd1', doc_title: '文档一', statement: 'L5/S1 是腰椎与骶椎之间的椎间盘', supported: true }] },
        { text: '本产品可以诊断你的病情。', citations: [{ evidence_doc_id: 'd1', doc_title: '文档一', statement: '本产品可以诊断你的病情', supported: true }] },
      ],
      unknown: [],
      next: [],
      videos: [],
    };
    const { sections, removed } = adapter.verifyStatements(draft, evidence);
    expect(sections.explain).toHaveLength(1);
    expect(sections.explain[0].citations[0].supported).toBe(true);
    expect(removed).toHaveLength(1);
    expect(removed[0].statement).toContain('诊断');
  });
});
