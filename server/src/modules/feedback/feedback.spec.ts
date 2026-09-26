import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { SchemaService } from '../../db/schema.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../../common/audit.service';
import { AuthGuard } from '../../common/auth.guard';
import { AdminGuard } from '../../common/admin.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { hashAdminPassword } from '../../common/password';
import { AdminAuthService } from '../admin/admin-auth.service';
import { PermissionGuard } from '../admin/permission.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { FeedbackController } from './feedback.controller';
import { AdminFeedbackController } from './admin-feedback.controller';
import { FeedbackService, SEVERITY_ORDER } from './feedback.service';
import { RULE_SET_VERSION } from '../safety/safety.rules';

interface Versions {
  analysis_version: number | null;
  analysis_id: string | null;
  model: { model_release_id: string; model_name: string; prompt_version: string } | null;
  content: { content_item_id: string; current_status: string; version: number | null } | null;
  rule_set_version: string;
}

interface FeedbackItem {
  id: string;
  type: 'feedback' | 'error_report';
  analysis_id: string | null;
  content_item_id: string | null;
  help_type: string | null;
  unsolved_question: string | null;
  category: string | null;
  description: string | null;
  severity: string | null;
  status: string;
  versions: Versions | null;
  created_at: string;
  redline: { auto_ingest: boolean; note: string };
}

interface QueueItem extends FeedbackItem {
  affected_users: { user_id: string; phone_masked: string }[];
}

interface Detail extends QueueItem {
  raw_content: unknown;
  authorization: { authorized: boolean; by: string | null; at: string | null; scope: string | null };
  handling: { id: string; action: string; comment: string | null; actor_id: string | null; created_at: string }[];
}

describe('T12 反馈与错误举报（四类版本 / 严重度分级 / 单条授权 / 处置记录 / 不自动入库）', () => {
  let app: INestApplication;
  let auth: AuthService;
  let db: DbService;
  let dir: string;
  let token: string;
  let otherToken: string;
  let userId: string;
  let analysisId: string;
  let contentItemId: string;
  /** 运行时生成的后台演示口令（覆盖种子哈希，避免在代码中出现明文） */
  const adminPassword = randomUUID();
  const adminTotp = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  /** 后台令牌（T14 起 /admin/* 走后台账号体系：合规角色） */
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-feedback-'));
    process.env.DB_DIR = dir;
    process.env.ADMIN_TOTP_DEMO_CODE = adminTotp;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [FeedbackController, AdminFeedbackController],
      providers: [FeedbackService, AuthService, AuditService, SchemaService, AdminAuthService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: AdminGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_GUARD, useClass: ConsentGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // 与 main.ts 保持一致：全局管道 + 拦截器 + 异常过滤
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    auth = app.get(AuthService);
    db = app.get(DbService);

    // T14：/admin/* 由 AdminGuard 保护，使用临床审核后台账号（feedback.view / consent.view / feedback.handle）
    db.app.prepare('UPDATE admin_user SET password_hash = ?').run(hashAdminPassword(adminPassword));
    const admin = app.get(AdminAuthService).login('clinician01', adminPassword, adminTotp);
    adminToken = admin.token;
    adminId = admin.admin.id;

    // 演示用户 u1（13800001234）已同意「健康信息处理」，种子数据含一页分析与已发布内容
    const me = auth.login('13800001234', '123456');
    token = me.token;
    userId = me.user.id;
    otherToken = auth.login('13900005678', '123456').token;

    analysisId = (
      db.app
        .prepare(
          `SELECT a.id FROM analysis a JOIN episode e ON e.id=a.episode_id WHERE e.user_id=? ORDER BY a.created_at ASC LIMIT 1`,
        )
        .get(userId) as { id: string }
    ).id;
    contentItemId = (
      db.app
        .prepare(`SELECT id FROM content_item WHERE current_status='已发布' AND offline_switch=0 LIMIT 1`)
        .get() as { id: string }
    ).id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = (t = token) => ({ Authorization: `Bearer ${t}` });
  /** 后台接口请求头（T14：/admin/* 使用后台账号令牌） */
  const HA = () => ({ Authorization: `Bearer ${adminToken}` });

  const submitFeedback = (body: Record<string, unknown>, t = token) =>
    api().post('/feedback').set(H(t)).send(body);

  const submitReport = (body: Record<string, unknown>, t = token) =>
    api().post('/feedback/error-report').set(H(t)).send(body);

  const count = (table: string) =>
    (db.app.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it('帮助类型反馈三种取值 + 未解决问题保存', async () => {
    for (const help_type of ['看懂了', '知道下一步', '都不好']) {
      const res = await submitFeedback({ analysis_id: analysisId, help_type });
      expect(res.body.code).toBe(0);
      const item = res.body.data as FeedbackItem;
      expect(item.type).toBe('feedback');
      expect(item.help_type).toBe(help_type);
      expect(item.status).toBe('已收到');
      expect(item.versions).toBeNull();
      // 红线标注：不自动进入训练或内容库
      expect(item.redline.auto_ingest).toBe(false);
      expect(item.redline.note).toContain('不自动进入训练或内容库');
      // 落库 feedback（is_error_report=0）
      const row = db.app
        .prepare('SELECT is_error_report, help_type, user_id FROM feedback WHERE id=?')
        .get(item.id) as { is_error_report: number; help_type: string; user_id: string };
      expect(row.is_error_report).toBe(0);
      expect(row.help_type).toBe(help_type);
      expect(row.user_id).toBe(userId);
    }

    // 未解决的问题保存
    const res = await submitFeedback({
      analysis_id: analysisId,
      help_type: '都不好',
      unsolved_question: '还是不知道复查该重点看什么',
    });
    expect(res.body.code).toBe(0);
    expect((res.body.data as FeedbackItem).unsolved_question).toBe('还是不知道复查该重点看什么');

    // 取值不在三种之内 → 40000
    const bad = await submitFeedback({ analysis_id: analysisId, help_type: '看不懂' });
    expect(bad.body.code).toBe(40000);

    // 引用他人分析 → 404（不暴露他人数据）
    const other = await submitFeedback({ analysis_id: analysisId, help_type: '看懂了' }, otherToken);
    expect(other.body.code).toBe(40400);
  });

  it('错误举报记录包含四类版本号（分析 / 模型 / 内容 / 规则集）', async () => {
    const res = await submitReport({
      analysis_id: analysisId,
      content_item_id: contentItemId,
      category: '解释与报告不符',
      description: '测试：解释与报告原文不一致',
      severity: 'medium',
    });
    expect(res.body.code).toBe(0);
    const item = res.body.data as FeedbackItem;
    expect(item.type).toBe('error_report');
    expect(item.severity).toBe('medium');
    expect(item.status).toBe('待处理');

    const v = item.versions!;
    expect(v).toBeTruthy();
    // 分析版本
    expect(v.analysis_id).toBe(analysisId);
    expect(v.analysis_version).toBe(
      (db.app.prepare('SELECT version FROM analysis WHERE id=?').get(analysisId) as { version: number }).version,
    );
    // 模型版本
    expect(v.model).toBeTruthy();
    expect(v.model!.model_name).toBe('本地模拟模型');
    expect(v.model!.prompt_version).toBe('prompt-v1');
    // 内容版本
    expect(v.content).toBeTruthy();
    expect(v.content!.content_item_id).toBe(contentItemId);
    expect(v.content!.current_status).toBe('已发布');
    expect(v.content!.version).toBeGreaterThanOrEqual(1);
    // 规则集版本
    expect(v.rule_set_version).toBe(RULE_SET_VERSION);
    expect(v.rule_set_version).toBe('safety-rules-v1.0');

    // 落库 feedback（is_error_report=1），四类版本存进 report_meta
    const row = db.app
      .prepare('SELECT is_error_report, report_meta, severity, category FROM feedback WHERE id=?')
      .get(item.id) as { is_error_report: number; report_meta: string; severity: string; category: string };
    expect(row.is_error_report).toBe(1);
    expect(row.severity).toBe('medium');
    expect(row.category).toBe('解释与报告不符');
    const meta = JSON.parse(row.report_meta) as Versions;
    expect(meta.analysis_version).toBe(v.analysis_version);
    expect(meta.model!.prompt_version).toBe('prompt-v1');
    expect(meta.content!.content_item_id).toBe(contentItemId);
    expect(meta.rule_set_version).toBe(RULE_SET_VERSION);

    // 未指定 severity 时按分类推断（其他 → low）
    const lowRes = await submitReport({
      analysis_id: analysisId,
      category: '其他',
      description: '测试：其他类型举报',
    });
    expect(lowRes.body.code).toBe(0);
    expect((lowRes.body.data as FeedbackItem).severity).toBe('low');

    // 分析与内容都不关联 → 40000
    const none = await submitReport({ category: '其他', description: '没有关联对象' });
    expect(none.body.code).toBe(40000);

    // 内容举报（不关联分析）：四类版本中分析与模型为空，内容与规则集仍在
    const contentOnly = await submitReport({
      content_item_id: contentItemId,
      category: '来源缺失',
      description: '测试：内容缺少来源',
      severity: 'medium',
    });
    expect(contentOnly.body.code).toBe(0);
    const cv = (contentOnly.body.data as FeedbackItem).versions!;
    expect(cv.analysis_version).toBeNull();
    expect(cv.model).toBeNull();
    expect(cv.content!.content_item_id).toBe(contentItemId);
    expect(cv.rule_set_version).toBe(RULE_SET_VERSION);
  });

  it('严重度分级与队列排序（high > medium > low）与筛选', async () => {
    const high = await submitReport({
      analysis_id: analysisId,
      category: '其他',
      description: '测试：可能造成健康风险的举报',
      severity: 'high',
    });
    const medium = await submitReport({
      analysis_id: analysisId,
      category: '解释与报告不符',
      description: '测试：解释与报告不符',
      severity: 'medium',
    });
    const low = await submitReport({
      analysis_id: analysisId,
      category: '内容出错',
      description: '测试：内容出错',
      severity: 'low',
    });
    expect(high.body.code + medium.body.code + low.body.code).toBe(0);
    const highId = (high.body.data as FeedbackItem).id;
    const mediumId = (medium.body.data as FeedbackItem).id;
    const lowId = (low.body.data as FeedbackItem).id;

    const queue = await api().get('/admin/feedback?type=error_report').set(HA());
    expect(queue.body.code).toBe(0);
    const items = queue.body.data as QueueItem[];
    const idx = (id: string) => items.findIndex((i) => i.id === id);
    // 队列按严重度分级排序：high 在 medium 前，medium 在 low 前
    expect(idx(highId)).toBeGreaterThanOrEqual(0);
    expect(idx(highId)).toBeLessThan(idx(mediumId));
    expect(idx(mediumId)).toBeLessThan(idx(lowId));
    // 整体排序权重非递减
    const orders = items.map((i) => SEVERITY_ORDER[i.severity as keyof typeof SEVERITY_ORDER] ?? 3);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));

    // 队列自动附带四类版本与受影响范围（演示实现：该分析 episode 所属用户脱敏手机号）
    const highItem = items.find((i) => i.id === highId)!;
    expect(highItem.versions!.rule_set_version).toBe(RULE_SET_VERSION);
    expect(highItem.affected_users.length).toBeGreaterThan(0);
    expect(highItem.affected_users[0].phone_masked).toBe('138****1234');
    expect(JSON.stringify(highItem.affected_users)).not.toMatch(/1\d{10}/);

    // 类型筛选：只返回帮助类型反馈
    const helpOnly = await api().get('/admin/feedback?type=feedback').set(HA());
    const helpItems = helpOnly.body.data as QueueItem[];
    expect(helpItems.length).toBeGreaterThan(0);
    expect(helpItems.every((i) => i.type === 'feedback')).toBe(true);

    // 状态筛选：只返回待处理
    const pending = await api().get('/admin/feedback?status=待处理').set(HA());
    const pendingItems = pending.body.data as QueueItem[];
    expect(pendingItems.every((i) => i.status === '待处理')).toBe(true);
    expect(pendingItems.map((i) => i.id)).toContain(highId);
  });

  it('单条授权查看：未授权时原始内容不可见，授权后可见且写审计', async () => {
    const created = await submitReport({
      analysis_id: analysisId,
      category: '解释与报告不符',
      description: '测试：授权查看场景',
      severity: 'medium',
    });
    const id = (created.body.data as FeedbackItem).id;

    // 未授权：用户原始内容不可见
    const before = await api().get(`/admin/feedback/${id}`).set(HA());
    expect(before.body.code).toBe(0);
    const beforeDetail = before.body.data as Detail;
    expect(beforeDetail.raw_content).toBe('未授权，不可查看');
    expect(beforeDetail.authorization.authorized).toBe(false);
    expect(beforeDetail.authorization.by).toBeNull();

    // 单条授权
    const granted = await api()
      .post(`/admin/feedback/${id}/authorize-view`)
      .set(HA())
      .send({ scope: '核对报告原文表述' });
    expect(granted.body.code).toBe(0);
    const afterDetail = granted.body.data as Detail;
    expect(afterDetail.authorization.authorized).toBe(true);
    expect(afterDetail.authorization.by).toBe(adminId);
    expect(afterDetail.authorization.at).toBeTruthy();
    expect(afterDetail.authorization.scope).toBe('核对报告原文表述');
    expect(typeof afterDetail.raw_content).toBe('object');
    const raw = afterDetail.raw_content as {
      records: { source_type: string; raw_text: string }[];
      reported_content: unknown;
    };
    expect(Array.isArray(raw.records)).toBe(true);
    expect(raw.records.length).toBeGreaterThan(0);
    expect(raw.records.some((r) => r.raw_text.includes('腰椎 MRI'))).toBe(true);

    // 授权后再次读取详情：原始内容可见
    const after = await api().get(`/admin/feedback/${id}`).set(HA());
    expect((after.body.data as Detail).raw_content).not.toBe('未授权，不可查看');

    // 审计日志记录授权人、时间、范围（只追加）
    const logs = db.app
      .prepare(
        `SELECT actor_id, action, target, diff FROM audit_log
         WHERE action='feedback.authorize_view' AND target=? ORDER BY created_at ASC`,
      )
      .all(`feedback:${id}`) as { actor_id: string; action: string; target: string; diff: string }[];
    expect(logs.length).toBe(1);
    expect(logs[0].actor_id).toBe(adminId);
    const diff = JSON.parse(logs[0].diff) as { scope: string };
    expect(diff.scope).toBe('核对报告原文表述');

    // 单条授权不是全局授权：另一条举报仍未授权
    const other = await submitReport({
      analysis_id: analysisId,
      category: '其他',
      description: '测试：未授权的另一条举报',
      severity: 'low',
    });
    const otherId = (other.body.data as FeedbackItem).id;
    const otherDetail = (await api().get(`/admin/feedback/${otherId}`).set(HA())).body.data as Detail;
    expect(otherDetail.raw_content).toBe('未授权，不可查看');
  });

  it('处置动作与处理记录（feedback_handling + 审计）', async () => {
    const created = await submitReport({
      analysis_id: analysisId,
      category: '解释与报告不符',
      description: '测试：处置动作场景',
      severity: 'medium',
    });
    const id = (created.body.data as FeedbackItem).id;

    const handled = await api()
      .post(`/admin/feedback/${id}/handle`)
      .set(HA())
      .send({ action: '转内容修正', comment: '已转内容运营核对脚本表述' });
    expect(handled.body.code).toBe(0);
    const detail = handled.body.data as Detail;
    expect(detail.status).toBe('处理中');
    expect(detail.handling.length).toBe(1);
    expect(detail.handling[0].action).toBe('转内容修正');
    expect(detail.handling[0].comment).toBe('已转内容运营核对脚本表述');
    expect(detail.handling[0].actor_id).toBe(adminId);

    // 处理记录落库 feedback_handling
    const rows = db.app
      .prepare('SELECT id, feedback_id, actor_id, action, comment FROM feedback_handling WHERE feedback_id=?')
      .all(id) as { id: string; feedback_id: string; actor_id: string; action: string; comment: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe('转内容修正');
    expect(rows[0].comment).toBe('已转内容运营核对脚本表述');
    expect(rows[0].actor_id).toBe(adminId);

    // 审计日志
    const log = db.app
      .prepare(`SELECT actor_id, action, target, diff FROM audit_log WHERE action='feedback.handle' AND target=?`)
      .get(`feedback:${id}`) as { actor_id: string; diff: string };
    expect(log.actor_id).toBe(adminId);
    expect((JSON.parse(log.diff) as { action: string }).action).toBe('转内容修正');

    // 再次处置：已回复用户 → 已处理（处理记录追加，不改历史）
    const replied = await api()
      .post(`/admin/feedback/${id}/handle`)
      .set(HA())
      .send({ action: '已回复用户', comment: '已回复用户并解释版本差异' });
    expect(replied.body.code).toBe(0);
    const repliedDetail = replied.body.data as Detail;
    expect(repliedDetail.status).toBe('已处理');
    expect(repliedDetail.handling.length).toBe(2);
    expect(repliedDetail.handling[1].action).toBe('已回复用户');

    // 非法处置动作 → 40000；空处理记录 → 40000
    const badAction = await api()
      .post(`/admin/feedback/${id}/handle`)
      .set(HA())
      .send({ action: '直接删除', comment: 'x' });
    expect(badAction.body.code).toBe(40000);
    const emptyComment = await api()
      .post(`/admin/feedback/${id}/handle`)
      .set(HA())
      .send({ action: '关闭', comment: '   ' });
    expect(emptyComment.body.code).toBe(40000);
    // 失败的处置不写处理记录
    expect(count('feedback_handling')).toBeGreaterThanOrEqual(2);

    // 处置动作与状态映射
    const expected: [string, string][] = [
      ['转模型复盘', '处理中'],
      ['无需处理', '无需处理'],
      ['关闭', '已关闭'],
    ];
    for (const [action, status] of expected) {
      const r = await submitReport({
        analysis_id: analysisId,
        category: '其他',
        description: `测试：${action}`,
        severity: 'low',
      });
      const rid = (r.body.data as FeedbackItem).id;
      const res = await api()
        .post(`/admin/feedback/${rid}/handle`)
        .set(HA())
        .send({ action, comment: `测试处置：${action}` });
      expect(res.body.code).toBe(0);
      expect((res.body.data as Detail).status).toBe(status);
      expect((res.body.data as Detail).handling[0].action).toBe(action);
    }

    // 不存在的反馈 → 404
    const missing = await api()
      .post('/admin/feedback/00000000-0000-0000-0000-000000000000/handle')
      .set(HA())
      .send({ action: '关闭', comment: 'x' });
    expect(missing.body.code).toBe(40400);
  });

  it('反馈不自动入库（不写 content / evidence / 模型训练相关表）', async () => {
    const tables = [
      'content_item',
      'content_version',
      'evidence_doc',
      'evidence_chunk',
      'analysis',
      'analysis_citation',
      'model_release',
      'eval_set',
      'eval_run',
      'case_submission',
      'review_record',
    ];
    const before: Record<string, number> = {};
    for (const t of tables) before[t] = count(t);
    const feedbackBefore = count('feedback');
    const handlingBefore = count('feedback_handling');

    // 提交帮助类型反馈 + 错误举报 + 处置
    await submitFeedback({ analysis_id: analysisId, help_type: '知道下一步', unsolved_question: '下一步做什么' });
    const report = await submitReport({
      analysis_id: analysisId,
      content_item_id: contentItemId,
      category: '解释与报告不符',
      description: '测试：不自动入库',
      severity: 'high',
    });
    const id = (report.body.data as FeedbackItem).id;
    await api().post(`/admin/feedback/${id}/authorize-view`).set(HA()).send({});
    await api()
      .post(`/admin/feedback/${id}/handle`)
      .set(HA())
      .send({ action: '转内容修正', comment: '转内容运营线下核对，不自动改写内容库' });

    // 内容库 / 证据库 / 模型与评测 / 投稿等表条数不变
    for (const t of tables) {
      expect(count(t)).toBe(before[t]);
    }
    // 只写了 feedback 与 feedback_handling
    expect(count('feedback')).toBe(feedbackBefore + 2);
    expect(count('feedback_handling')).toBe(handlingBefore + 1);

    // 反馈与举报只存在于 feedback 表，不会以任何形式进入内容库或训练数据
    const leaked = db.app
      .prepare(
        `SELECT n FROM (
           SELECT COUNT(*) AS n FROM content_version WHERE script LIKE '%测试：不自动入库%'
           UNION ALL SELECT COUNT(*) FROM evidence_chunk WHERE content LIKE '%测试：不自动入库%'
           UNION ALL SELECT COUNT(*) FROM evidence_doc WHERE title LIKE '%测试：不自动入库%'
         )`,
      )
      .all() as { n: number }[];
    expect(leaked.reduce((sum, r) => sum + r.n, 0)).toBe(0);
  });

  it('未登录返回 40100', async () => {
    const create = await api().post('/feedback').send({ analysis_id: analysisId, help_type: '看懂了' });
    expect(create.body.code).toBe(40100);
    const report = await api().post('/feedback/error-report').send({ analysis_id: analysisId, category: '其他', description: 'x' });
    expect(report.body.code).toBe(40100);
    const mine = await api().get('/feedback/mine');
    expect(mine.body.code).toBe(40100);
    const queue = await api().get('/admin/feedback');
    expect(queue.body.code).toBe(40100);
    const detail = await api().get(`/admin/feedback/${analysisId}`);
    expect(detail.body.code).toBe(40100);
  });

  it('越权查看他人反馈返回 404，/feedback/mine 只含本人反馈', async () => {
    // u1 的一条反馈
    const created = await submitFeedback({ analysis_id: analysisId, help_type: '看懂了' });
    const ownId = (created.body.data as FeedbackItem).id;

    // u2 查看 u1 的反馈 → 404
    const cross = await api().get(`/feedback/${ownId}`).set(H(otherToken));
    expect(cross.body.code).toBe(40400);

    // u2 的列表不含 u1 的反馈
    const otherMine = (await api().get('/feedback/mine').set(H(otherToken))).body.data as FeedbackItem[];
    expect(otherMine.some((f) => f.id === ownId)).toBe(false);

    // 本人可以查看自己的反馈与处理进度
    const mine = (await api().get(`/feedback/${ownId}`).set(H())).body.data as Detail;
    expect(mine.id).toBe(ownId);
    expect(mine.type).toBe('feedback');
    expect(mine.redline.auto_ingest).toBe(false);
  });
});
