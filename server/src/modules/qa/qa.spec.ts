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
import { SafetyService } from '../safety/safety.service';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { QaController } from './qa.controller';
import { QaService } from './qa.service';
import { buildQaAnswer, isReassurance, QA_DISCLAIMER, REASSURANCE_REPLY } from './qa-answer';

describe('T08 问与解释', () => {
  let app: INestApplication;
  let auth: AuthService;
  let episodes: EpisodesService;
  let db: DbService;
  let dir: string;
  let token: string;
  let episodeId: string;
  let sessionId = '';

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-qa-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [QaController],
      providers: [
        AuthService,
        EpisodesService,
        QaService,
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

    auth = app.get(AuthService);
    episodes = app.get(EpisodesService);
    db = app.get(DbService);

    // 演示用户（13800001234）已同意「健康信息处理」，种子数据含病程 / 报告 / 一页分析
    const me = auth.login('13800001234', '123456');
    token = me.token;
    const eps = episodes.list(me.user.id);
    episodeId = eps[0].id as string;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = (t = token) => ({ Authorization: `Bearer ${t}` });

  it('创建会话：可关联 episode；未登录 40100；未同意 40310', async () => {
    const res = await api().post('/qa/sessions').set(H()).send({ episode_id: episodeId });
    expect(res.body.code).toBe(0);
    sessionId = res.body.data.id;
    expect(res.body.data.episode_id).toBe(episodeId);
    expect(res.body.data.message_count).toBe(0);
    expect(res.body.data.last_message).toBeNull();

    // 未登录
    const anon = await api().post('/qa/sessions').send({});
    expect(anon.body.code).toBe(40100);

    // 未同意「健康信息处理」
    const fresh = auth.login('13700000088', '123456');
    const noConsent = await api().post('/qa/sessions').set(H(fresh.token)).send({});
    expect(noConsent.body.code).toBe(40310);
  });

  it('越界问题（诊断 / 手术 / 用药）：refused=true 且带 followup_question，不生成个性化解释', async () => {
    const cases: [string, string][] = [
      ['我是不是椎间盘突出了？', '不能判断这是什么病'],
      ['需不需要做微创手术？', '不能给出手术建议'],
      ['吃什么止疼药好？', '不能提供用药'],
    ];
    for (const [question, expectText] of cases) {
      const res = await api()
        .post(`/qa/sessions/${sessionId}/messages`)
        .set(H())
        .send({ content: question });
      expect(res.body.code).toBe(0);
      expect(res.body.data.refused).toBe(true);
      expect(res.body.data.reply).toContain(expectText);
      expect(res.body.data.followup_question).toBeTruthy();
      expect(res.body.data.add_to_followup).toBe(true); // 可一键加入复诊问题
      expect(res.body.data.citations).toEqual([]); // 越界不生成个性化解释
      expect(res.body.data.close_round).toBe(false);
    }
    // 落库：assistant 消息 refused=1 且带复诊问题
    const rows = db.app
      .prepare(
        `SELECT COUNT(*) AS n FROM qa_message
         WHERE session_id=? AND role='assistant' AND refused=1 AND followup_question IS NOT NULL`,
      )
      .get(sessionId) as { n: number };
    expect(rows.n).toBe(3);
  });

  it('范围内问题：正常回答且带 citations（evidence_doc / care_event / analysis）', async () => {
    const res = await api()
      .post(`/qa/sessions/${sessionId}/messages`)
      .set(H())
      .send({ content: '报告里 L5/S1 是什么意思？' });
    expect(res.body.code).toBe(0);
    const d = res.body.data;
    expect(d.refused).toBe(false);
    expect(d.close_round).toBe(false);
    expect(d.citations.length).toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const c of d.citations) {
      // 每条引用只带三种来源 ID 之一
      const ids = [c.evidence_doc_id, c.care_event_id, c.analysis_id].filter(Boolean);
      expect(ids).toHaveLength(1);
      expect(c.statement).toBeTruthy();
      expect(c.source_label).toBeTruthy();
      kinds.add(c.kind);
    }
    expect(kinds.has('evidence_doc')).toBe(true);
    expect(kinds.has('analysis')).toBe(true);
    expect(kinds.has('care_event')).toBe(true);
    // 回答末尾带 disclaimer；上下文引用最新一次一页分析
    expect(d.reply).toContain(QA_DISCLAIMER);
    expect(d.reply).toContain('系统生成内容');
    expect(d.reply).toContain('不作诊断');
    expect(d.context.analysis_id).toBeTruthy();
    expect(d.context.analysis_version).toBeGreaterThanOrEqual(1);
  });

  it('红旗问题：40910 / 40911 + 就医提示（含 matched），消息仍保存为系统提示', async () => {
    const high = await api()
      .post(`/qa/sessions/${sessionId}/messages`)
      .set(H())
      .send({ content: '这两天会阴部麻木，伴大小便控制变化' });
    expect(high.body.code).toBe(40911); // high → 停止个性化
    expect(high.body.data.title).toBe('需要及时寻求专业帮助');
    expect(high.body.data.headline).toBe('建议尽快就医');
    expect(Array.isArray(high.body.data.matched)).toBe(true);
    expect(high.body.data.matched[0].severity).toBe('high');
    expect(high.body.data.matched[0].rule_code).toBeTruthy();
    expect(high.body.data.matched[0].advice).toBeTruthy();
    expect(high.body.data.rule_set_version).toBeTruthy();

    const medium = await api()
      .post(`/qa/sessions/${sessionId}/messages`)
      .set(H())
      .send({ content: '腰痛伴发热两天' });
    expect(medium.body.code).toBe(40910); // medium → 提示就医
    expect(medium.body.data.matched[0].severity).toBe('medium');

    // 本轮不再生成解释；用户问题与系统提示消息均已保存
    const rows = db.app
      .prepare(`SELECT role, content FROM qa_message WHERE session_id=? ORDER BY created_at ASC, rowid ASC`)
      .all(sessionId) as { role: string; content: string }[];
    expect(rows.some((r) => r.role === 'user' && r.content.includes('会阴部麻木'))).toBe(true);
    expect(rows.some((r) => r.role === 'assistant' && r.content.includes('就医'))).toBe(true);
  });

  it('连续 3 次求保证：close_round=true 且文案稳定', async () => {
    const created = await api().post('/qa/sessions').set(H()).send({});
    const sid = created.body.data.id as string;
    const ask = (content: string) =>
      api().post(`/qa/sessions/${sid}/messages`).set(H()).send({ content });

    const r1 = await ask('你能保证没事吗？');
    expect(r1.body.code).toBe(0);
    expect(r1.body.data.close_round).toBe(false);
    const r2 = await ask('肯定没问题吧？');
    expect(r2.body.data.close_round).toBe(false);

    const r3 = await ask('一定会好吗？');
    expect(r3.body.code).toBe(0);
    expect(r3.body.data.close_round).toBe(true);
    expect(r3.body.data.reply).toContain(REASSURANCE_REPLY);
    expect(r3.body.data.reply).toContain('以医生的评估为准');
    expect(r3.body.data.refused).toBe(false);

    // 第 4 次仍是同一段稳定文案（结束本轮后不改变解释）
    const r4 = await ask('百分百没事吗？');
    expect(r4.body.data.close_round).toBe(true);
    expect(r4.body.data.reply).toBe(r3.body.data.reply);
  });

  it('会话历史保存与可查询（列表摘要 + 详情全文）', async () => {
    const list = await api().get('/qa/sessions').set(H());
    expect(list.body.code).toBe(0);
    const mine = (list.body.data as { id: string; message_count: number; last_message: { content: string; created_at: string } | null }[]).find(
      (s) => s.id === sessionId,
    );
    expect(mine).toBeTruthy();
    expect(mine!.message_count).toBeGreaterThan(0);
    expect(mine!.last_message).toBeTruthy();
    expect(mine!.last_message!.content.length).toBeGreaterThan(0);
    expect(mine!.last_message!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const detail = await api().get(`/qa/sessions/${sessionId}`).set(H());
    expect(detail.body.code).toBe(0);
    expect(detail.body.data.id).toBe(sessionId);
    const messages = detail.body.data.messages as {
      role: string;
      content: string;
      citations: unknown[];
      refused: boolean;
      followup_question: string | null;
      add_to_followup: boolean;
    }[];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].role).toBe('user');
    expect(messages.some((m) => m.role === 'assistant' && m.citations.length > 0)).toBe(true);
    expect(messages.some((m) => m.refused && m.add_to_followup && m.followup_question)).toBe(true);
    // 系统生成内容在历史中带 disclaimer
    expect(messages.some((m) => m.role === 'assistant' && m.content.includes('不作诊断'))).toBe(true);
  });

  it('结束本轮：返回本轮小结', async () => {
    const res = await api().post(`/qa/sessions/${sessionId}/close`).set(H());
    expect(res.body.code).toBe(0);
    expect(res.body.data.closed).toBe(true);
    expect(res.body.data.closed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const rs = res.body.data.round_summary;
    expect(rs.question_count).toBeGreaterThan(0);
    expect(rs.answer_count).toBeGreaterThan(0);
    expect(rs.refused_count).toBe(3);
    expect(rs.followup_questions.length).toBe(3);
    expect(rs.citation_count).toBeGreaterThan(0);
    expect(rs.summary_text).toContain('仅供参考');
    expect(res.body.data.disclaimer).toContain('不作诊断');
  });

  it('越权访问他人会话返回 404', async () => {
    const other = auth.login('13900005678', '123456').token; // 另一位已同意用户
    const detail = await api().get(`/qa/sessions/${sessionId}`).set(H(other));
    expect(detail.body.code).toBe(40400);
    const ask = await api()
      .post(`/qa/sessions/${sessionId}/messages`)
      .set(H(other))
      .send({ content: '在吗' });
    expect(ask.body.code).toBe(40400);
    const close = await api().post(`/qa/sessions/${sessionId}/close`).set(H(other));
    expect(close.body.code).toBe(40400);
  });

  it('本地回答构造：无依据显示「尚未确认」；求保证特征识别', () => {
    const empty = buildQaAnswer({
      question: '一个完全无关的问题',
      evidence: [],
      analysis: null,
      events: [],
    });
    expect(empty.citations).toEqual([]);
    expect(empty.unconfirmed).toBe(true);
    expect(empty.reply).toContain('尚未确认');
    expect(empty.reply).toContain(QA_DISCLAIMER);

    for (const q of ['保证没事', '肯定吗', '一定会好吗', '百分百', '百分百没事吧']) {
      expect(isReassurance(q)).toBe(true);
    }
    for (const q of ['报告里 L5/S1 是什么意思', '复诊需要重点看什么', '今天能坐多久比较合适']) {
      expect(isReassurance(q)).toBe(false);
    }
  });
});
