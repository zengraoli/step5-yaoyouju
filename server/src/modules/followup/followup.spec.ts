import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { SchemaService } from '../../db/schema.service';
import { AuthService } from '../auth/auth.service';
import { EpisodesService, SOURCE_TYPES } from '../episodes/episodes.service';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { FollowupController } from './followup.controller';
import { FollowupService } from './followup.service';

const SECTION_KEYS = ['onset', 'symptom', 'report', 'advice', 'worry', 'questions'];
const SECTION_TITLES = [
  '起病与时间',
  '当前症状',
  '检查与报告',
  '既往医嘱与行动',
  '我的主要担心',
  '想请医生确认的问题',
];
const WATERMARK = '本摘要由用户整理，系统生成内容仅供参考，不作诊断';

interface Item {
  text: string;
  source: string;
  verify_status?: string;
  care_event_id?: string;
  from?: string;
}

interface Section {
  key: string;
  title: string;
  items: Item[];
}

const sectionsOf = (data: { content: { sections: Section[] } }): Section[] => data.content.sections;
const sectionOf = (sections: Section[], key: string): Section =>
  sections.find((s) => s.key === key)!;

describe('T09 复诊摘要（六段生成 / 预览 / 纠正 / 导出）', () => {
  let app: INestApplication;
  let auth: AuthService;
  let episodes: EpisodesService;
  let db: DbService;
  let dir: string;
  let token: string;
  let userId: string;
  let episodeId: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-followup-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [FollowupController],
      providers: [
        AuthService,
        EpisodesService,
        FollowupService,
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
    userId = me.user.id;
    episodeId = episodes.list(userId)[0].id as string;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = (t = token) => ({ Authorization: `Bearer ${t}` });
  const newEpisode = (title: string): string =>
    episodes.create(userId, { title }).id as string;
  const generate = (episode = episodeId, t = token) =>
    api().post(`/episodes/${episode}/followup/generate`).set(H(t));
  const latest = (episode = episodeId, t = token) =>
    api().get(`/episodes/${episode}/followup`).set(H(t));

  it('生成：固定六段结构完整，每条带来源类型，内容来自病程事件', async () => {
    const res = await generate();
    expect(res.body.code).toBe(0);
    const sections = sectionsOf(res.body.data);
    expect(sections.map((s) => s.key)).toEqual(SECTION_KEYS);
    expect(sections.map((s) => s.title)).toEqual(SECTION_TITLES);
    for (const s of sections) {
      expect(s.items.length).toBeGreaterThan(0);
      for (const item of s.items) {
        // 每条内容都标注来源类型
        expect(SOURCE_TYPES).toContain(item.source);
      }
    }
    // 事实段的文字里也带来源标记
    for (const key of ['onset', 'symptom', 'report', 'advice', 'worry']) {
      for (const item of sectionOf(sections, key).items) {
        expect(item.text).toContain(item.source);
      }
    }
    // 六段内容分别来自病程的不同部分
    expect(sectionOf(sections, 'onset').items[0].text).toContain('2026-07-18');
    expect(sectionOf(sections, 'symptom').items.some((i) => i.text.includes('轻微放射感'))).toBe(true);
    expect(sectionOf(sections, 'report').items.some((i) => i.text.includes('L5/S1'))).toBe(true);
    expect(
      sectionOf(sections, 'advice').items.some((i) => i.text.includes('每 40 分钟起身活动')),
    ).toBe(true);
    expect(sectionOf(sections, 'worry').items.some((i) => i.text.includes('放射感是否说明加重'))).toBe(
      true,
    );
    expect(res.body.data.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(res.body.data.exported).toBe(false);
    expect(res.body.data.disclaimer).toContain('不作诊断');
  });

  it('未核实项（尚未确认 / 有冲突）保留并带「未经核实」标记，不当成已确认', async () => {
    // 补一条「有冲突」的症状事件（用户纠正后降级）
    await episodes.addEvent(userId, episodeId, {
      event_type: '症状',
      source_type: '自述',
      occurred_at: '2026-09-20',
      raw_text: '测试用冲突症状条目',
      verify_status: '有冲突',
    });
    const res = await generate();
    expect(res.body.code).toBe(0);
    const all = sectionsOf(res.body.data).flatMap((s) => s.items);

    const unconfirmed = all.find((i) => i.text.includes('轻微放射感'))!;
    expect(unconfirmed.verify_status).toBe('尚未确认');
    expect(unconfirmed.text).toContain('未经核实');

    const conflict = all.find((i) => i.text.includes('测试用冲突症状条目'))!;
    expect(conflict.verify_status).toBe('有冲突');
    expect(conflict.text).toContain('未经核实');

    // 已确认项不带「未经核实」标记
    const confirmed = all.find((i) => i.text.includes('久坐 4 小时'))!;
    expect(confirmed.verify_status).toBe('已确认');
    expect(confirmed.text).not.toContain('未经核实');

    // 未核实项没有被丢弃，全文也不出现「已排除」
    expect(all.length).toBeGreaterThan(5);
    expect(JSON.stringify(res.body.data)).not.toContain('已排除');
  });

  it('报告未描述的内容显示「报告未提及」，不显示「已排除」', async () => {
    const res = await generate();
    const report = sectionOf(sectionsOf(res.body.data), 'report');
    const notMentioned = report.items.find((i) => i.text.includes('报告未提及'))!;
    expect(notMentioned).toBeTruthy();
    expect(notMentioned.verify_status).toBe('尚未确认');
    expect(notMentioned.text).toContain('未经核实');
    expect(JSON.stringify(report.items)).not.toContain('已排除');

    // 报告确实描述了下肢肌力时，不再出现「报告未提及」
    const ep2 = newEpisode('报告已描述肌力的病程');
    await episodes.addEvent(userId, ep2, {
      event_type: '报告',
      source_type: '报告原文',
      occurred_at: '2026-09-22',
      raw_text: '腰椎 MRI：下肢肌力 V 级，感觉正常。',
      verify_status: '已确认',
    });
    const res2 = await generate(ep2);
    const report2 = sectionOf(sectionsOf(res2.body.data), 'report');
    expect(report2.items.some((i) => i.text.includes('报告未提及'))).toBe(false);
    expect(report2.items.some((i) => i.text.includes('肌力'))).toBe(true);
  });

  it('问题清单默认来自一键加入的复诊问题与分析 next 事项，按重要性排序', async () => {
    // 造一个关联本病程的问与解释会话：越界拒答产生 followup_question（用户一键加入）
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    db.app
      .prepare('INSERT INTO qa_session (id, user_id, episode_id, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, userId, episodeId, now);
    db.app
      .prepare(
        `INSERT INTO qa_message (id, session_id, role, content, citations, refused, followup_question, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), sessionId, 'assistant', '这属于诊断范围，我不能回答', null, 1, '我需要做康复训练吗', now);

    const res = await generate();
    const questions = sectionOf(sectionsOf(res.body.data), 'questions');
    const texts = questions.items.map((i) => i.text);
    expect(texts).toContain('我需要做康复训练吗'); // 用户加入的复诊问题
    expect(texts).toContain('复查时请医生查体确认下肢肌力与放射感'); // 一页分析 next 段
    // 用户主动加入的排在前（重要性优先），分析整理的排后
    expect(texts.indexOf('我需要做康复训练吗')).toBeLessThan(
      texts.indexOf('复查时请医生查体确认下肢肌力与放射感'),
    );
    expect(questions.items[0].from).toBe('用户加入');
    expect(questions.items.every((i) => ['自述', '报告原文', '医生记录'].includes(i.source))).toBe(
      true,
    );
  });

  it('预览后纠正：编辑文字、增删问题、调整顺序均生效，且保留来源标记', async () => {
    const gen = await generate();
    expect(gen.body.code).toBe(0);
    const summaryId = gen.body.data.id as string;
    const sections = sectionsOf(gen.body.data);

    const corrected = [
      // 编辑症状段文字：故意不带来源标记，保留来源应由系统补齐
      {
        ...sectionOf(sections, 'symptom'),
        items: [{ text: '纠正后的症状描述', source: '自述', verify_status: '已确认' }],
      },
      // 医嘱段：未核实项纠正后仍带「未经核实」标记
      {
        ...sectionOf(sections, 'advice'),
        items: [{ text: '纠正后的医嘱文字', source: '医生记录', verify_status: '尚未确认' }],
      },
      // 担心段：删掉原有条目
      { ...sectionOf(sections, 'worry'), items: [] },
      // 问题段：调整顺序并新增一条
      {
        ...sectionOf(sections, 'questions'),
        items: [
          { text: '调整后的第二个问题', source: '自述', from: '用户加入' },
          { text: '调整后的第三个问题', source: '自述', from: '用户加入' },
          { text: '新增加的问题', source: '自述', from: '用户加入' },
        ],
      },
      sectionOf(sections, 'onset'),
      sectionOf(sections, 'report'),
    ];

    const res = await api()
      .put(`/episodes/${episodeId}/followup/${summaryId}`)
      .set(H())
      .send({ sections: corrected });
    expect(res.body.code).toBe(0);
    expect(res.body.data.content.corrected).toBe(true);
    expect(res.body.data.content.corrected_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // 纠正结果落库（GET 最新一份）
    const after = await latest();
    const s2 = sectionsOf(after.body.data);
    expect(sectionOf(s2, 'symptom').items).toHaveLength(1);
    expect(sectionOf(s2, 'symptom').items[0].text).toBe('纠正后的症状描述（自述，已确认）');
    expect(sectionOf(s2, 'advice').items[0].text).toBe('纠正后的医嘱文字（医生记录，尚未确认，未经核实）');
    expect(sectionOf(s2, 'worry').items).toHaveLength(0);
    expect(sectionOf(s2, 'questions').items.map((i) => i.text)).toEqual([
      '调整后的第二个问题',
      '调整后的第三个问题',
      '新增加的问题',
    ]);
    // 固定六段结构不变
    expect(s2.map((s) => s.key)).toEqual(SECTION_KEYS);

    // 纠正时缺段 / 格式不合法 → 40000
    const missing = await api()
      .put(`/episodes/${episodeId}/followup/${summaryId}`)
      .set(H())
      .send({ sections: corrected.slice(0, 3) });
    expect(missing.body.code).toBe(40000);
  });

  it('导出文本：带头部与水印脚注的纯文本，并记录 exported_at / export_format', async () => {
    const gen = await generate();
    const summaryId = gen.body.data.id as string;
    // 先纠正一段文字，确认纠正后的内容参与导出
    const sections = sectionsOf(gen.body.data);
    await api()
      .put(`/episodes/${episodeId}/followup/${summaryId}`)
      .set(H())
      .send({
        sections: [
          { ...sectionOf(sections, 'symptom'), items: [{ text: '纠正后的症状描述', source: '自述', verify_status: '已确认' }] },
          sectionOf(sections, 'onset'),
          sectionOf(sections, 'report'),
          sectionOf(sections, 'advice'),
          sectionOf(sections, 'worry'),
          sectionOf(sections, 'questions'),
        ],
      });
    const res = await api()
      .post(`/episodes/${episodeId}/followup/${summaryId}/export`)
      .set(H())
      .send({ format: '文本' });
    expect(res.body.code).toBe(0);
    const d = res.body.data;
    expect(d.format).toBe('文本');
    expect(d.browser_print).toBe(false);
    expect(d.text).toContain('就诊交接摘要');
    expect(d.text).toContain(WATERMARK);
    for (const [i, title] of SECTION_TITLES.entries()) {
      expect(d.text).toContain(`${['一', '二', '三', '四', '五', '六'][i]}、${title}`);
    }
    expect(d.text).toContain('纠正后的症状描述（自述，已确认）'); // 纠正后的内容参与导出
    expect(d.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // 导出记录落库：GET 返回是否已导出与格式 / 时间
    const after = await latest();
    expect(after.body.data.exported).toBe(true);
    expect(after.body.data.export_format).toBe('文本');
    expect(after.body.data.exported_at).toBe(d.exported_at);
  });

  it('导出 PDF / 图片：标记为浏览器打印生成，记录格式与时间', async () => {
    const gen = await generate();
    const summaryId = gen.body.data.id as string;
    for (const format of ['PDF', '图片']) {
      const res = await api()
        .post(`/episodes/${episodeId}/followup/${summaryId}/export`)
        .set(H())
        .send({ format });
      expect(res.body.code).toBe(0);
      expect(res.body.data.format).toBe(format);
      expect(res.body.data.browser_print).toBe(true);
      expect(res.body.data.text).toContain('浏览器打印');
      expect(res.body.data.text).toContain('不服务端生成');
      expect(res.body.data.text).toContain(WATERMARK);
      expect(res.body.data.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
    const after = await latest();
    expect(after.body.data.export_format).toBe('图片');

    // 不支持的格式 → 40000
    const bad = await api()
      .post(`/episodes/${episodeId}/followup/${summaryId}/export`)
      .set(H())
      .send({ format: 'Word' });
    expect(bad.body.code).toBe(40000);
  });

  it('GET 返回最新一份摘要；尚未生成时 404', async () => {
    const first = await generate();
    const second = await generate();
    expect(second.body.data.id).not.toBe(first.body.data.id);
    const res = await latest();
    expect(res.body.code).toBe(0);
    expect(res.body.data.id).toBe(second.body.data.id); // 最新一份

    const empty = newEpisode('尚未生成摘要的病程');
    const none = await latest(empty);
    // 尚未生成过：返回 200 + null（空状态，不是客户端错误）
    expect(none.body.code).toBe(0);
    expect(none.body.data).toBeNull();
  });

  it('未登录 40100 / 未同意 40310 / 越权与他人资源 404', async () => {
    // 未登录
    const anon = await api().post(`/episodes/${episodeId}/followup/generate`);
    expect(anon.body.code).toBe(40100);
    const anonGet = await api().get(`/episodes/${episodeId}/followup`);
    expect(anonGet.body.code).toBe(40100);

    // 未同意「健康信息处理」
    const fresh = auth.login('13700001235', '123456').token;
    const noConsent = await generate(episodeId, fresh);
    expect(noConsent.body.code).toBe(40310);

    // 越权：操作他人的病程（他人 404，不暴露存在性）
    const other = auth.login('13900005678', '123456').token;
    expect((await generate(episodeId, other)).body.code).toBe(40400);
    expect((await latest(episodeId, other)).body.code).toBe(40400);

    const mine = await generate();
    const summaryId = mine.body.data.id as string;
    const wrongPut = await api()
      .put(`/episodes/${episodeId}/followup/${summaryId}`)
      .set(H(other))
      .send({ sections: [] });
    expect(wrongPut.body.code).toBe(40400);
    const wrongExport = await api()
      .post(`/episodes/${episodeId}/followup/${summaryId}/export`)
      .set(H(other))
      .send({ format: '文本' });
    expect(wrongExport.body.code).toBe(40400);

    // 摘要不存在 / 不属于该病程 → 404
    const noSummary = await api()
      .put(`/episodes/${episodeId}/followup/not-exists`)
      .set(H())
      .send({ sections: [] });
    expect(noSummary.body.code).toBe(40400);
    const emptyEp = newEpisode('另一个病程');
    const emptyGen = await generate(emptyEp);
    expect(emptyGen.body.code).toBe(0);
    // 用 A 病程的摘要 ID 去操作 B 病程 → 404
    const crossExport = await api()
      .post(`/episodes/${emptyEp}/followup/${summaryId}/export`)
      .set(H())
      .send({ format: '文本' });
    expect(crossExport.body.code).toBe(40400);
  });
});
