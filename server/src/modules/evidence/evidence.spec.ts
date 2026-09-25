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
import { AuditService } from '../../common/audit.service';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { ApiException, ErrorCode } from '../../common/api-error';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import {
  LOCAL_VECTOR_DIM,
  RETRIEVAL_SCOPE,
  cosineSimilarity,
  localVector,
  queryTerms,
} from './evidence-retrieval';
import { CHUNK_MAX, CHUNK_MIN, CHUNK_OVERLAP, splitIntoChunks } from './chunker';

/** 捕获业务异常，便于断言错误码与中文文案 */
function caught(fn: () => unknown): ApiException {
  try {
    fn();
  } catch (e) {
    return e as ApiException;
  }
  throw new Error('期望抛出 ApiException，但实际没有抛错');
}

interface DocItem {
  id: string;
  title: string;
  source_type: string;
  source_url: string | null;
  license: string | null;
  verified_at: string | null;
  active: boolean;
  chunk_count: number;
  citation_count: number;
  ingest_status: string;
  ingested_at: string | null;
  updated_at: string | null;
}

interface Pipeline {
  doc_id: string;
  doc_title: string;
  status: string;
  chunk_count: number;
  last_ingested_at: string | null;
  error: string | null;
  raw_text_length: number;
  positions: number[];
  chunker: { min: number; max: number; overlap: number };
}

interface Hit {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  content: string;
  score: number;
  source_type?: string;
  license?: string;
  position?: number;
  keyword_score?: number;
  vector_score?: number;
}

interface SearchResult {
  query: string;
  results: Hit[];
  result_count: number;
  retrieval_snapshot: {
    strategy: string;
    query_terms: string[];
    doc_ids: string[];
    chunk_count: number;
    elapsed_ms: number;
    scope: string;
    active_only: boolean;
  };
  disclaimer: string;
}

interface Impact {
  doc_id: string;
  doc_title: string;
  active: boolean;
  citation_count: number;
  analyses: {
    analysis_id: string;
    episode_id: string;
    episode_title: string;
    analysis_version: number;
    created_at: string;
    statements: string[];
    explain_count: number;
  }[];
  contents: unknown[];
  note: string;
  confirm_hint: string;
}

/** 单句素材（约 40 字一句） */
const SENTENCES = [
  '演示证据原文：久坐超过一小时后，腰痛常常加重，起身活动后可以缓解。',
  '适当休息与循序渐进的运动有助于功能恢复，但任何活动都不应使症状明显加重。',
  '如果出现腿麻、放射到小腿的疼痛，或伴随大小便控制改变，需要尽快就医评估。',
  '影像报告中的退行性改变在人群中较常见，需要结合症状与医生查体判断，不能单独作为诊断依据。',
  '报告未提及的结构不代表没有问题，也不能说已经排除；尚未确认的项要如实标注。',
  '本段为演示文本，仅用于验证切分入库与本地检索，不涉及任何真实患者信息。',
  '记录每天能坐多久、睡眠影响和最担心的问题，复诊时交给医生，是很有帮助的做法。',
  '观察性研究不能证明因果关系，个体差异较大，请以医生的评估为准。',
];

/** 长文本（多组多句，远超单片段上限），用于验证切分与位置连续 */
const LONG_TEXT = Array.from(
  { length: 6 },
  (_, g) => SENTENCES.map((s, i) => `第${g + 1}组第${i + 1}句：${s}`).join('\n'),
).join('\n');

/** 只属于某一篇文档的独特关键词（用于验证停用后检索不到） */
const UNIQUE_MARK = '示范专用关键词';
/** HTTP 全流程用例使用的另一个独特关键词（与上面不共享 2-gram） */
const FLOW_MARK = '全流程核验用语';

describe('T11 医学证据库（文档管理 / 切分入库管线 / 本地检索 / 停用立即生效）', () => {
  let app: INestApplication;
  let auth: AuthService;
  let db: DbService;
  let evidence: EvidenceService;
  let dir: string;
  let token: string;

  const api = () => request(app.getHttpServer());
  const H = () => ({ Authorization: `Bearer ${token}` });
  const adminId = (name: string): string =>
    (db.app.prepare('SELECT id FROM admin_user WHERE name=?').get(name) as { id: string }).id;
  const editor = () => adminId('editor01');
  const clinician = () => adminId('clinician01');
  const docIdByTitle = (title: string): string =>
    (db.app.prepare('SELECT id FROM evidence_doc WHERE title=?').get(title) as { id: string }).id;
  const list = async (qs = '') =>
    (await api().get(`/evidence${qs}`).set(H())).body.data as DocItem[];
  const pipelineOf = (id: string) => evidence.pipeline(id);
  const search = (q: string, limit = 5) => evidence.search(q, limit);

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-evidence-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [EvidenceController],
      providers: [
        AuthService,
        EvidenceService,
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
    db = app.get(DbService);
    evidence = app.get(EvidenceService);

    // 演示用户（13800001234）已同意「健康信息处理」
    token = auth.login('13800001234', '123456').token;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---------- 文档管理与筛选 ----------

  it('列表：种子 6 篇证据文档，带片段数与被引用数，时间字段为 UTC ISO8601', () => {
    const items = evidence.list();
    expect(items).toHaveLength(6);
    for (const d of items) {
      expect(d.chunk_count).toBeGreaterThan(0);
      expect(typeof d.citation_count).toBe('number');
      expect(d.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
    // 种子一页分析引用了 MRI 术语说明（2 条）与久坐研究（1 条）
    const mri = items.find((d) => d.title.includes('腰椎 MRI 报告常见术语说明'))!;
    expect(mri.citation_count).toBe(2);
    expect(mri.source_type).toBe('审核科普');
    const sitting = items.find((d) => d.title.includes('久坐与腰背痛'))!;
    expect(sitting.citation_count).toBe(1);
    expect(sitting.source_type).toBe('研究');
    // 未被引用的文档引用数为 0
    const redFlags = items.find((d) => d.title.includes('红旗信号'))!;
    expect(redFlags.citation_count).toBe(0);
    // 全部默认启用
    expect(items.every((d) => d.active)).toBe(true);
  });

  it('列表筛选：按来源类型与启用状态过滤', async () => {
    const all = await list();
    const guidelines = all.filter((d) => d.source_type === '指南');
    expect(guidelines.length).toBeGreaterThan(0);
    expect(guidelines.every((d) => d.source_type === '指南')).toBe(true);

    const onlyGuideline = await list('?source_type=指南');
    expect(onlyGuideline).toHaveLength(guidelines.length);
    expect(onlyGuideline.every((d) => d.source_type === '指南')).toBe(true);

    // 停用一篇后再按启用状态筛选
    const target = guidelines[0];
    evidence.setActive(clinician(), target.id, false, '演示停用');
    const activeOnly = await list('?active=true');
    expect(activeOnly.some((d) => d.id === target.id)).toBe(false);
    expect(activeOnly).toHaveLength(all.length - 1);

    const inactiveOnly = await list('?active=false');
    expect(inactiveOnly).toHaveLength(1);
    expect(inactiveOnly[0].id).toBe(target.id);

    // 组合筛选：来源类型 + 启用状态
    const combined = await list(`?source_type=指南&active=false`);
    expect(combined.map((d) => d.id)).toEqual([target.id]);

    // 恢复，避免影响后续用例
    evidence.setActive(clinician(), target.id, true, '测试恢复');
    expect((await list('?active=false'))).toHaveLength(0);
  });

  it('新建证据文档：标题与来源类型必填，来源类型受枚举约束', () => {
    expect(caught(() => evidence.create(editor(), { title: '  ', source_type: '指南' })).code).toBe(
      ErrorCode.BAD_REQUEST,
    );
    expect(
      caught(() => evidence.create(editor(), { title: 'x', source_type: '维基百科' })).message,
    ).toContain('来源类型必须是');

    const created = evidence.create(editor(), {
      title: '《演示新增证据（T11）》',
      source_type: '研究',
      source_url: 'local://evidence/t11-new',
      license: '演示数据',
      verified_at: '2026-09-20',
    });
    expect(created.source_type).toBe('研究');
    expect(created.license).toBe('演示数据');
    expect(created.verified_at).toBe('2026-09-20');
    expect(created.active).toBe(true);
    expect(created.chunk_count).toBe(0);
    expect(created.ingest_status).toBe('待切分');
    expect(created.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    // 审计写入
    const audit = db.app
      .prepare('SELECT action, diff FROM audit_log WHERE target=? AND action=?')
      .get(`evidence_doc:${created.id}`, 'evidence.create') as { diff: string } | undefined;
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit!.diff).title).toBe('《演示新增证据（T11）》');

    // 详情 404：不存在的 ID
    expect(caught(() => evidence.detail('not-exist')).code).toBe(ErrorCode.NOT_FOUND);
  });

  it('编辑证据文档：改动写审计，未改动的字段不进 diff', () => {
    const doc = evidence.create(editor(), {
      title: '《演示编辑前（T11）》',
      source_type: '指南',
      license: '演示数据',
      verified_at: '2026-09-01',
    });
    const before = evidence.detail(doc.id);

    const after = evidence.update(clinician(), doc.id, {
      title: '《演示编辑后（T11）》',
      license: '演示数据（已修订）',
      verified_at: '2026-09-25',
    });
    expect(after.title).toBe('《演示编辑后（T11）》');
    expect(after.license).toBe('演示数据（已修订）');
    expect(after.verified_at).toBe('2026-09-25');
    expect(after.source_type).toBe(before.source_type); // 未改动

    const audit = db.app
      .prepare('SELECT diff FROM audit_log WHERE target=? AND action=?')
      .get(`evidence_doc:${doc.id}`, 'evidence.update') as { diff: string } | undefined;
    expect(audit).toBeTruthy();
    const diff = JSON.parse(audit!.diff) as Record<string, { from: unknown; to: unknown }>;
    expect(Object.keys(diff).sort()).toEqual(['license', 'title', 'verified_at']);
    expect(diff.title).toEqual({ from: '《演示编辑前（T11）》', to: '《演示编辑后（T11）》' });
    expect(diff.source_type).toBeUndefined();

    // 非法来源类型 / 空标题
    expect(caught(() => evidence.update(clinician(), doc.id, { title: ' ' })).code).toBe(
      ErrorCode.BAD_REQUEST,
    );
    expect(caught(() => evidence.update(clinician(), doc.id, { source_type: '博客' })).message).toContain(
      '来源类型',
    );
  });

  // ---------- 切分入库管线 ----------

  it('切分入库：长文本切成多个片段、位置连续、每片 50-300 字、带 16 维本地向量', () => {
    const doc = evidence.create(editor(), {
      title: '《演示切分（T11）》',
      source_type: '研究',
      raw_text: LONG_TEXT,
    });
    expect(evidence.pipeline(doc.id).status).toBe('待切分');
    expect(evidence.pipeline(doc.id).chunk_count).toBe(0);

    const after = evidence.ingest(editor(), doc.id);
    expect(after.status).toBe('已切分');
    expect(after.chunk_count).toBeGreaterThan(2);
    expect(after.last_ingested_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(after.error).toBeNull();
    expect(after.raw_text_length).toBe(LONG_TEXT.length);

    // 位置从 0 开始连续
    expect(after.positions).toEqual(Array.from({ length: after.chunk_count }, (_, i) => i));

    const chunks = db.app
      .prepare('SELECT content, embedding, position FROM evidence_chunk WHERE doc_id=? ORDER BY position ASC')
      .all(doc.id) as { content: string; embedding: string; position: number }[];
    expect(chunks).toHaveLength(after.chunk_count);
    for (const [i, c] of chunks.entries()) {
      expect(c.position).toBe(i);
      expect(c.content.length).toBeGreaterThanOrEqual(1);
      expect(c.content.length).toBeLessThanOrEqual(CHUNK_MAX);
      const vec = JSON.parse(c.embedding) as number[];
      expect(vec).toHaveLength(LOCAL_VECTOR_DIM);
      expect(vec.every((n) => typeof n === 'number')).toBe(true);
    }
    // 相邻片段保留重叠上下文（重叠字数 > 0 时前一片末尾出现在后一片开头）
    if (CHUNK_OVERLAP > 0 && chunks.length > 1) {
      expect(chunks[1].content.startsWith(chunks[0].content.slice(-CHUNK_OVERLAP))).toBe(true);
    }

    // 管线状态可查：切分参数对外暴露
    expect(evidence.pipeline(doc.id).chunker).toEqual({
      min: CHUNK_MIN,
      max: CHUNK_MAX,
      overlap: CHUNK_OVERLAP,
    });

    // 审计写入
    const audit = db.app
      .prepare('SELECT diff FROM audit_log WHERE target=? AND action=?')
      .get(`evidence_doc:${doc.id}`, 'evidence.ingest') as { diff: string } | undefined;
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit!.diff).chunk_count).toBe(after.chunk_count);
  });

  it('切分入库幂等：二次 ingest 片段数不变、位置与内容不变', () => {
    const doc = evidence.create(editor(), {
      title: '《演示幂等（T11）》',
      source_type: '审核科普',
      raw_text: LONG_TEXT,
    });
    const first = evidence.ingest(editor(), doc.id);
    const firstChunks = db.app
      .prepare('SELECT content, position FROM evidence_chunk WHERE doc_id=? ORDER BY position ASC')
      .all(doc.id) as { content: string; position: number }[];

    // 重复 ingest（含第三次）
    const second = evidence.ingest(editor(), doc.id);
    const third = evidence.ingest(editor(), doc.id);
    expect(second.chunk_count).toBe(first.chunk_count);
    expect(third.chunk_count).toBe(first.chunk_count);
    expect(second.positions).toEqual(first.positions);

    const afterChunks = db.app
      .prepare('SELECT content, position FROM evidence_chunk WHERE doc_id=? ORDER BY position ASC')
      .all(doc.id) as { content: string; position: number }[];
    expect(afterChunks).toEqual(firstChunks);
    // 片段总数没有增长
    expect(
      (db.app.prepare('SELECT COUNT(*) AS n FROM evidence_chunk WHERE doc_id=?').get(doc.id) as { n: number })
        .n,
    ).toBe(first.chunk_count);

    // 原文变短后再次 ingest：片段数随之变化（按位置更新 + 删除多余旧片段）
    evidence.update(editor(), doc.id, { raw_text: LONG_TEXT.slice(0, 120) });
    const shrunk = evidence.ingest(editor(), doc.id);
    expect(shrunk.chunk_count).toBeLessThan(first.chunk_count);
    expect(shrunk.positions).toEqual(Array.from({ length: shrunk.chunk_count }, (_, i) => i));
  });

  it('入库管线：原文为空返回 40000，不产生片段；失败状态可读', () => {
    const doc = evidence.create(editor(), {
      title: '《演示空原文（T11）》',
      source_type: '指南',
    });
    const err = caught(() => evidence.ingest(editor(), doc.id));
    expect(err.code).toBe(ErrorCode.BAD_REQUEST);
    expect(err.message).toContain('原文');

    // 失败状态：直接置为失败（模拟入库异常），管线状态应可读出错误信息
    db.app
      .prepare(`UPDATE evidence_doc SET ingest_status='失败', ingest_error=? WHERE id=?`)
      .run('演示失败原因：原文编码不支持', doc.id);
    const p = evidence.pipeline(doc.id);
    expect(p.status).toBe('失败');
    expect(p.error).toBe('演示失败原因：原文编码不支持');
    expect(p.chunk_count).toBe(0);

    // 未知状态值按「待切分」处理
    db.app.prepare(`UPDATE evidence_doc SET ingest_status='未知状态', ingest_error=NULL WHERE id=?`).run(doc.id);
    expect(evidence.pipeline(doc.id).status).toBe('待切分');
  });

  it('切分函数：单句不超上限、过长硬切、空文本返回空', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   \n  ')).toEqual([]);
    // 单个超长句子硬切为多片，每片 <= max
    const long = '演示'.repeat(400);
    const parts = splitIntoChunks(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.content.length).toBeLessThanOrEqual(CHUNK_MAX);
    expect(parts.map((p) => p.position)).toEqual(parts.map((_, i) => i));
    // 同一份原文切分结果稳定（幂等的基础）
    expect(splitIntoChunks(LONG_TEXT)).toEqual(splitIntoChunks(LONG_TEXT));
  });

  // ---------- 本地检索 ----------

  it('检索：能搜到相关片段，带来源信息（标题 / 来源类型 / 许可）与得分', () => {
    const res = search('久坐 腰痛 L5/S1 椎间盘', 5);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.result_count).toBe(res.results.length);
    for (const r of res.results) {
      expect(r.content.length).toBeGreaterThan(0);
      expect(r.doc_id).toBeTruthy();
      expect(r.doc_title).toBeTruthy();
      expect(r.source_type).toBeTruthy();
      expect(EVIDENCE_TYPES).toContain(r.source_type!);
      expect(r.score).toBeGreaterThan(0);
      expect(typeof r.keyword_score).toBe('number');
      expect(typeof r.vector_score).toBe('number');
    }
    // 得分倒序
    const scores = res.results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // 检索快照：策略名、命中 doc_ids、耗时、范围
    const snap = res.retrieval_snapshot;
    expect(snap.strategy).toBeTruthy();
    expect(snap.chunk_count).toBe(res.results.length);
    expect(snap.doc_ids).toEqual([...new Set(res.results.map((r) => r.doc_id))]);
    expect(snap.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(snap.scope).toBe(RETRIEVAL_SCOPE);
    expect(snap.active_only).toBe(true);
    expect(snap.query_terms.length).toBeGreaterThan(0);
    expect(res.disclaimer).toContain('不作诊断');

    // 命中的文档都真实存在于证据库（产品红线：来源只来自证据库）
    for (const id of snap.doc_ids) {
      expect(db.app.prepare('SELECT id FROM evidence_doc WHERE id=?').get(id)).toBeTruthy();
    }
  });

  it('检索只在证据库内：无关查询不返回结果，limit 生效', () => {
    expect(search('量子纠缠与星系演化', 5).results).toEqual([]);
    const limited = search('久坐 腰痛 L5/S1 椎间盘', 2);
    expect(limited.results).toHaveLength(2);
  });

  it('停用后搜不到：active=0 的文档片段被排除，且立即生效', () => {
    // 建一篇只含独特关键词的证据并入库
    const doc = evidence.create(editor(), {
      title: '《演示停用检索（T11）》',
      source_type: '研究',
      raw_text: `${LONG_TEXT}\n${UNIQUE_MARK}：本句包含只在本文档出现的内容，用于验证停用后检索不到。`,
    });
    evidence.ingest(editor(), doc.id);

    // 启用时：独特关键词只命中这一篇
    const before = search(UNIQUE_MARK, 10);
    expect(before.results.length).toBeGreaterThan(0);
    expect(before.results.every((r) => r.doc_id === doc.id)).toBe(true);
    expect(before.results[0].doc_title).toBe('《演示停用检索（T11）》');

    // 停用：立即生效，下一次检索即排除
    const off = evidence.setActive(clinician(), doc.id, false, '演示停用');
    expect(off.doc.active).toBe(false);
    const afterOff = search(UNIQUE_MARK, 10);
    expect(afterOff.results).toEqual([]);
    expect(afterOff.retrieval_snapshot.doc_ids).toEqual([]);
    expect(afterOff.retrieval_snapshot.chunk_count).toBe(0);

    // 混合查询里也不再出现该文档
    const mixed = search('久坐 腰痛 示范专用关键词', 10);
    expect(mixed.results.some((r) => r.doc_id === doc.id)).toBe(false);

    // 重新启用：又能检索到
    evidence.setActive(clinician(), doc.id, true, '演示恢复');
    const backOn = search(UNIQUE_MARK, 10);
    expect(backOn.results.length).toBeGreaterThan(0);
    expect(backOn.results.every((r) => r.doc_id === doc.id)).toBe(true);
  });

  it('停用影响预览：返回引用该证据的分析列表（分析 ID、episode、版本、引用的 statement）', () => {
    // 种子一页分析引用了《腰椎 MRI 报告常见术语说明（演示）》
    const docId = docIdByTitle('《腰椎 MRI 报告常见术语说明（演示）》');
    const impact = evidence.impactPreview(docId);
    expect(impact.doc_id).toBe(docId);
    expect(impact.active).toBe(true);
    expect(impact.citation_count).toBe(2);
    expect(impact.analyses).toHaveLength(1);

    const ref = impact.analyses[0];
    expect(ref.analysis_id).toBeTruthy();
    expect(ref.episode_id).toBeTruthy();
    expect(ref.episode_title).toBe('久坐后腰痛');
    expect(ref.analysis_version).toBe(1);
    expect(ref.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // 引用的 statement：来自 analysis_citation 与 analysis.sections.explain[].citations
    expect(ref.statements).toContain('L5/S1 指第 5 节腰椎与第 1 节骶椎之间的椎间盘');
    expect(ref.statements).toContain('报告未提及的结构不代表没有问题');
    expect(ref.explain_count).toBe(ref.statements.length);
    expect(impact.confirm_hint).toContain('停用后');

    // 未被引用的证据：空列表 + 可安全停用提示
    const unused = evidence.impactPreview(docIdByTitle('《何时需要尽快就医：红旗信号（演示）》'));
    expect(unused.analyses).toEqual([]);
    expect(unused.citation_count).toBe(0);
    expect(unused.confirm_hint).toContain('可安全停用');
  });

  it('停用接口：返回文档与影响预览，重复停用返回 40900，写审计', () => {
    const docId = docIdByTitle('《久坐与腰背痛：观察性研究汇总（演示）》');
    const result = evidence.setActive(clinician(), docId, false, '来源待复核');
    expect(result.doc.active).toBe(false);
    expect(result.impact.doc_id).toBe(docId);
    expect(result.impact.analyses.length).toBeGreaterThan(0);
    expect(result.audit_action).toBe('evidence.deactivate');

    // 重复停用 → 40900
    expect(caught(() => evidence.setActive(clinician(), docId, false)).message).toBe('该证据文档已是停用状态');

    // 审计记录影响面
    const audit = db.app
      .prepare('SELECT diff FROM audit_log WHERE target=? AND action=?')
      .get(`evidence_doc:${docId}`, 'evidence.deactivate') as { diff: string } | undefined;
    expect(audit).toBeTruthy();
    const diff = JSON.parse(audit!.diff) as { impact: { citation_count: number; analysis_ids: string[] } };
    expect(diff.impact.citation_count).toBeGreaterThan(0);
    expect(diff.impact.analysis_ids.length).toBeGreaterThan(0);

    // 恢复
    const on = evidence.setActive(clinician(), docId, true);
    expect(on.doc.active).toBe(true);
    expect(on.audit_action).toBe('evidence.activate');
    expect(caught(() => evidence.setActive(clinician(), docId, true)).message).toBe('该证据文档已是启用状态');
  });

  // ---------- 本地向量 ----------

  it('向量函数：localVector 维度与词项计数、余弦相似度计算正确', () => {
    expect(localVector('')).toHaveLength(LOCAL_VECTOR_DIM);
    expect(localVector('腰痛 腰痛 久坐')).toEqual([2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(localVector('无关内容')).toEqual(new Array(LOCAL_VECTOR_DIM).fill(0));

    // 相同向量相似度 1
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    // 正交向量相似度 0
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    // 零向量 → 0（不产生 NaN）
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [1, 1])).toBe(0);
    // 方向一致但长度不同 → 1
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1, 10);
    // 已知值：[1,2,3] · [4,5,6] = 32 / (sqrt(14) * sqrt(77))
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(32 / (Math.sqrt(14) * Math.sqrt(77)), 10);
    // 维度不一致时按较短一侧计算
    expect(cosineSimilarity([1, 1, 1], [1, 1])).toBeCloseTo(1, 10);
  });

  it('向量参与打分：含证据词项的查询在向量维度上有非零得分', () => {
    const res = search('久坐 腰痛 腿麻 放射 就医', 5);
    expect(res.results.length).toBeGreaterThan(0);
    // 至少有一个片段同时有关键词分与向量分
    expect(res.results.some((r) => (r.keyword_score ?? 0) > 0 && (r.vector_score ?? 0) > 0)).toBe(true);
  });

  it('queryTerms：术语词典命中 + 中文 / 字母数字 2-gram', () => {
    const terms = queryTerms('久坐后腰痛，L5/S1 椎间盘轻度膨出');
    expect(terms.has('L5/S1')).toBe(true); // 术语词典
    expect(terms.has('久坐')).toBe(true);
    expect(terms.has('腰痛')).toBe(true);
    expect(terms.has('膨出')).toBe(true);
    expect(queryTerms('')).toEqual(new Set());
  });

  // ---------- HTTP 接口 ----------

  it('HTTP：/evidence 列表与筛选、详情、管线状态、影响预览', async () => {
    const res = await api().get('/evidence').set(H());
    expect(res.body.code).toBe(0);
    // 种子 6 篇 + 前面用例新建的文档
    const all = res.body.data as DocItem[];
    // 种子 6 篇证据文档都在列表里（其余为前面用例新建的）
    const seedTitles = [
      '《腰背痛基层诊疗指南（演示摘录）》',
      '《腰椎 MRI 报告常见术语说明（演示）》',
      '《久坐与腰背痛：观察性研究汇总（演示）》',
      '《急性腰痛运动干预随机对照试验（演示）》',
      '《腰痛自我管理清单（演示）》',
      '《何时需要尽快就医：红旗信号（演示）》',
    ];
    expect(all.map((d) => d.title)).toEqual(expect.arrayContaining(seedTitles));
    expect(all.length).toBe(evidence.list().length);

    const filtered = await api().get('/evidence?source_type=研究').set(H());
    expect(filtered.body.code).toBe(0);
    expect((filtered.body.data as DocItem[]).every((d) => d.source_type === '研究')).toBe(true);

    const first = seedTitles[0];
    const doc = all.find((d) => d.title === first)!;
    const detail = await api().get(`/evidence/${doc.id}`).set(H());
    expect(detail.body.code).toBe(0);
    expect(detail.body.data.raw_text_length).toBeGreaterThan(0);

    const pipeline = await api().get(`/evidence/${doc.id}/pipeline`).set(H());
    expect(pipeline.body.code).toBe(0);
    expect((pipeline.body.data as Pipeline).status).toBe('已切分');
    expect((pipeline.body.data as Pipeline).chunk_count).toBeGreaterThan(0);

    const impact = await api().get(`/evidence/${doc.id}/impact`).set(H());
    expect(impact.body.code).toBe(0);
    expect((impact.body.data as Impact).doc_id).toBe(doc.id);

    // 不存在的 ID → 40400
    expect((await api().get('/evidence/not-exist').set(H())).body.code).toBe(40400);
    expect((await api().get('/evidence/not-exist/pipeline').set(H())).body.code).toBe(40400);
    // 未登录 → 40100
    expect((await api().get('/evidence')).body.code).toBe(40100);
    expect((await api().post('/evidence/search').send({ q: '久坐' })).body.code).toBe(40100);
  });

  it('HTTP：POST 与 GET 检索都返回片段与 retrieval_snapshot', async () => {
    const post = await api().post('/evidence/search').set(H()).send({ q: '久坐 腰痛 L5/S1', limit: 3 });
    expect(post.body.code).toBe(0);
    const postData = post.body.data as SearchResult;
    expect(postData.results.length).toBeGreaterThan(0);
    expect(postData.results.length).toBeLessThanOrEqual(3);
    expect(postData.retrieval_snapshot.strategy).toBeTruthy();
    expect(postData.retrieval_snapshot.doc_ids.length).toBeGreaterThan(0);

    const get = await api().get('/evidence/search?q=久坐%20腰痛%20L5%2FS1&limit=2').set(H());
    expect(get.body.code).toBe(0);
    const getData = get.body.data as SearchResult;
    expect(getData.results).toHaveLength(2);
    expect(getData.results[0].doc_title).toBeTruthy();
    expect(getData.results[0].source_type).toBeTruthy();
    expect(getData.results[0].license).toBeTruthy();
  });

  it('HTTP：新建 → 停用 → 检索不到 → 影响预览有数据 → 恢复', async () => {
    // 新建一篇只含独特关键词的证据
    const created = await api()
      .post('/evidence')
      .set(H())
      .send({
        title: '《演示全流程（T11）》',
        source_type: '指南',
        source_url: 'local://evidence/t11-flow',
        license: '演示数据',
        verified_at: '2026-09-24',
        raw_text: `${LONG_TEXT}\n${FLOW_MARK}流程验证：停用后这篇证据不能再被检索到。`,
      });
    expect(created.body.code).toBe(0);
    const docId = created.body.data.id as string;

    // 入库 → 检索得到
    const ingest = await api().post(`/evidence/${docId}/ingest`).set(H());
    expect(ingest.body.code).toBe(0);
    expect((ingest.body.data as Pipeline).chunk_count).toBeGreaterThan(2);

    const found = await api().get(`/evidence/search?q=${encodeURIComponent(FLOW_MARK)}`).set(H());
    expect((found.body.data as SearchResult).results.some((r) => r.doc_id === docId)).toBe(true);

    // 停用 → 检索不到，影响预览可查
    const off = await api().post(`/evidence/${docId}/active`).set(H()).send({
      active: false,
      reason: '演示：来源待复核',
    });
    expect(off.body.code).toBe(0);
    expect(off.body.data.doc.active).toBe(false);
    expect(off.body.data.impact.doc_id).toBe(docId);
    expect(off.body.data.impact.confirm_hint).toBeTruthy();

    const gone = await api().get(`/evidence/search?q=${encodeURIComponent(FLOW_MARK)}`).set(H());
    expect((gone.body.data as SearchResult).results).toEqual([]);
    const inactiveList = await api().get('/evidence?active=false').set(H());
    expect((inactiveList.body.data as DocItem[]).some((d) => d.id === docId)).toBe(true);

    // 编辑后恢复启用 → 又能检索到
    const patched = await api()
      .patch(`/evidence/${docId}`)
      .set(H())
      .send({ title: '《演示全流程（T11）已修订》' });
    expect(patched.body.code).toBe(0);
    expect(patched.body.data.title).toBe('《演示全流程（T11）已修订》');

    await api().post(`/evidence/${docId}/active`).set(H()).send({ active: true });
    const back = await api().get(`/evidence/search?q=${encodeURIComponent(FLOW_MARK)}`).set(H());
    expect((back.body.data as SearchResult).results.some((r) => r.doc_id === docId)).toBe(true);

    // 参数校验：来源类型非法 / 标题为空
    const bad = await api()
      .post('/evidence')
      .set(H())
      .send({ title: 'x', source_type: '报纸' });
    expect(bad.body.code).toBe(40000);
  });
});

/** 来源类型枚举（与 EvidenceService.EVIDENCE_SOURCE_TYPES 一致） */
const EVIDENCE_TYPES = ['指南', '研究', '审核科普'];
