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
import { SwitchesService } from '../switches/switches.service';
import { AuditService } from '../../common/audit.service';
import { AuthGuard } from '../../common/auth.guard';
import { ConsentGuard } from '../../common/consent.guard';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';
import { ApiException, ErrorCode } from '../../common/api-error';
import { ContentsController } from './contents.controller';
import { ContentsService } from './contents.service';

interface ListItem {
  id: string;
  type: string;
  title: string;
  applicable_scope: string;
  not_applicable: string;
  version: number | null;
  recommend_reason: string;
}

interface Detail {
  id: string;
  type: string;
  title: string;
  applicable_scope: string;
  not_applicable: string;
  current_status: string;
  offline: boolean;
  current_version: { version: number; script: string; subtitle_text: string; published_at: string } | null;
  versions: { version: number; script: string; is_current: boolean; published_at: string | null }[];
  review_records: { decision: string; comment: string | null; reviewer_name: string | null }[];
  disclaimer: string;
}

/** 捕获业务异常，便于断言错误码与中文文案 */
function caught(fn: () => unknown): ApiException {
  try {
    fn();
  } catch (e) {
    return e as ApiException;
  }
  throw new Error('期望抛出 ApiException，但实际没有抛错');
}

describe('T10 内容库与审核流程（状态机 / 双人确认 / 下线生效 / 用户端可见性）', () => {
  let app: INestApplication;
  let auth: AuthService;
  let db: DbService;
  let contents: ContentsService;
  let switches: SwitchesService;
  let dir: string;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-contents-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [ContentsController],
      providers: [
        AuthService,
        ContentsService,
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
    db = app.get(DbService);
    contents = app.get(ContentsService);
    switches = app.get(SwitchesService);

    // 演示用户（13800001234）已同意「健康信息处理」，种子数据含病程 / 报告 / 一页分析
    const me = auth.login('13800001234', '123456');
    token = me.token;
    userId = me.user.id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const api = () => request(app.getHttpServer());
  const H = (t = token) => ({ Authorization: `Bearer ${t}` });
  const adminId = (name: string): string =>
    (db.app.prepare('SELECT id FROM admin_user WHERE name=?').get(name) as { id: string }).id;
  const list = async (t = token) =>
    (await api().get('/contents').set(H(t))).body.data as ListItem[];
  const detailOf = async (id: string, t = token) =>
    (await api().get(`/contents/${id}`).set(H(t))).body.data as Detail;
  const draftInput = (title: string) => ({
    type: '图文组件',
    title,
    applicable_scope: '久坐相关慢性腰痛',
    not_applicable: '伴有腿麻无力等红旗信号',
    script: '初稿脚本',
    subtitle_text: '替代文字：示意图',
  });

  // ---------- 用户端可见性 ----------

  it('用户端列表只返回已发布且未下线内容（草稿 / 待审 / 已审定 / 已撤回 / 更正中不可见）', async () => {
    const res = await api().get('/contents').set(H());
    expect(res.body.code).toBe(0);
    const items = res.body.data as ListItem[];
    const titles = items.map((c) => c.title);

    // 已发布（种子 4 条：2 视频 + 2 图文组件）
    expect(titles).toContain('看懂腰椎 MRI 报告：L5/S1 是什么');
    expect(titles).toContain('久坐腰痛的日常调整：三个可做的小改变');
    expect(items).toHaveLength(4);

    // 其余状态一律不可见
    expect(titles).not.toContain('腿麻了一定是椎间盘突出吗'); // 待医学审核
    expect(titles).not.toContain('复诊前这样整理问题清单'); // 已审定
    expect(titles).not.toContain('睡眠与腰痛：互相影响'); // 草稿
    expect(titles).not.toContain('如何记录"今天的状态"'); // 草稿
    expect(titles).not.toContain('搬重物姿势纠正（旧版）'); // 已撤回
    expect(titles).not.toContain('腰背肌锻炼入门（更正中）'); // 更正中

    // 非已发布 / 已撤回内容详情一律 404（不暴露存在性）
    const hidden = db.app
      .prepare(`SELECT id FROM content_item WHERE current_status != '已发布' OR offline_switch=1`)
      .all() as { id: string }[];
    expect(hidden.length).toBeGreaterThan(0);
    for (const row of hidden) {
      const r = await api().get(`/contents/${row.id}`).set(H());
      expect(r.body.code).toBe(40400);
    }

    // 未登录 40100
    expect((await api().get('/contents')).body.code).toBe(40100);
    expect((await api().get(`/contents/${items[0].id}`)).body.code).toBe(40100);
  });

  it('每条内容带适用范围、不适用范围、当前版本号与非空推荐理由', async () => {
    const items = await list();
    for (const c of items) {
      expect(c.applicable_scope.length).toBeGreaterThan(0);
      expect(typeof c.not_applicable).toBe('string');
      expect(typeof c.version).toBe('number');
      expect(c.version).toBeGreaterThan(0);
      expect(typeof c.recommend_reason).toBe('string');
      expect(c.recommend_reason.length).toBeGreaterThan(0);
    }
    // 演示规则：按用户 episode 关键词匹配适用范围（该用户久坐后腰痛）
    const sitting = items.find((c) => c.title.includes('久坐'))!;
    expect(sitting.recommend_reason).toContain('久坐');
    expect(sitting.recommend_reason).toContain(sitting.applicable_scope);
  });

  it('详情含当前版本脚本、字幕与文字替代、审核记录与版本链', async () => {
    const items = await list();
    const d = await detailOf(items[0].id);
    expect(d.current_version).toBeTruthy();
    expect(d.current_version!.script.length).toBeGreaterThan(0);
    expect(typeof d.current_version!.subtitle_text).toBe('string');
    expect(d.current_version!.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Array.isArray(d.review_records)).toBe(true);
    expect(d.review_records.length).toBeGreaterThan(0);
    expect(Array.isArray(d.versions)).toBe(true);
    expect(d.versions.filter((v) => v.is_current)).toHaveLength(1);
    expect(d.disclaimer).toContain('不作诊断');
  });

  // ---------- 开关联动 ----------

  it('开关联动：「案例卡片」关闭时案例不返回，「视频推荐」关闭时视频推荐位为空但不报错', async () => {
    // 造一个已发布的「案例」内容（走完整审核流程）
    const caseDraft = contents.createDraft(adminId('editor01'), {
      type: '案例',
      title: '演示案例：久坐腰痛两个月',
      applicable_scope: '久坐相关慢性腰痛',
      not_applicable: '红旗信号',
      script: '案例脚本（演示）',
      subtitle_text: '案例文字替代',
    });
    contents.submitForReview(adminId('editor01'), caseDraft.id, { evidence: '依据：审核科普' });
    contents.approve(adminId('clinician01'), caseDraft.id, { review_scope: '医学准确性' });
    const published = contents.publish(adminId('tech01'), caseDraft.id);
    expect(published.current_status).toBe('已发布');

    // 案例卡片开关默认关闭 → 不返回（含按类型筛选）
    expect((await list()).some((c) => c.id === caseDraft.id)).toBe(false);
    const filtered = await api().get('/contents?type=案例').set(H());
    expect(filtered.body.code).toBe(0);
    expect(filtered.body.data).toHaveLength(0);

    // 开启后返回，且类型筛选生效
    switches.setEnabled('案例卡片', true, '测试开启', null);
    expect((await list()).some((c) => c.id === caseDraft.id)).toBe(true);
    const onlyCases = (await api().get('/contents?type=案例').set(H())).body.data as ListItem[];
    expect(onlyCases).toHaveLength(1);
    expect(onlyCases[0].type).toBe('案例');

    // 视频推荐开关关闭 → 视频推荐位为空但不报错，图文组件仍返回
    switches.setEnabled('视频推荐', false, '测试关闭', null);
    const noVideos = await api().get('/contents').set(H());
    expect(noVideos.body.code).toBe(0);
    const items = noVideos.body.data as ListItem[];
    expect(items.some((c) => c.type === '视频')).toBe(false);
    expect(items.some((c) => c.type === '图文组件')).toBe(true);
    // 按类型筛选视频同样为空
    expect((await api().get('/contents?type=视频').set(H())).body.data).toHaveLength(0);

    // 恢复开关
    switches.setEnabled('视频推荐', true, '测试恢复', null);
    expect((await list()).some((c) => c.type === '视频')).toBe(true);
  });

  // ---------- 状态机 ----------

  it('状态机合法流转全通：草稿 → 待医学审核 → 已审定 → 已发布，并写审核记录与审计', async () => {
    const draft = contents.createDraft(adminId('editor01'), draftInput('测试：状态机全流程'));
    expect(draft.current_status).toBe('草稿');

    const submitted = contents.submitForReview(adminId('editor01'), draft.id, {
      script: '提交审核时的脚本',
      evidence: '依据：《腰背痛基层诊疗指南（演示摘录）》',
    });
    expect(submitted.current_status).toBe('待医学审核');

    const approved = contents.approve(adminId('clinician01'), draft.id, {
      review_scope: '医学准确性',
      comment: '内容准确，同意发布',
    });
    expect(approved.current_status).toBe('已审定');

    // 发布人与审核人不是同一人 → 通过
    const published = contents.publish(adminId('tech01'), draft.id);
    expect(published.current_status).toBe('已发布');
    expect(published.offline).toBe(false);
    expect(published.current_version).toBeTruthy();
    expect(published.current_version!.version).toBe(1);
    expect(published.current_version!.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // 审核记录：提交 / 通过 / 发布 三条，审核人可追溯
    const decisions = published.review_records.map((r) => r.decision);
    expect(decisions).toEqual(['提交审核', '通过', '发布']);
    expect(published.review_records[1].reviewer_name).toBe('clinician01');
    expect(published.review_records[1].review_scope).toBe('医学准确性');

    // 审计日志（只追加）记录了创建、提交、审核与发布
    const audits = db.app
      .prepare(`SELECT action FROM audit_log WHERE target=? ORDER BY created_at ASC`)
      .all(`content_item:${draft.id}`) as { action: string }[];
    expect(audits.map((a) => a.action)).toEqual([
      'content.create_draft',
      'content.submit_review',
      'content.approve',
      'content.publish',
    ]);
  });

  it('非法流转返回 40900 与中文说明（草稿直接发布、已发布直接提交审核等）', async () => {
    const draft = contents.createDraft(adminId('editor01'), draftInput('测试：非法流转'));

    // 草稿不能直接发布
    let err = caught(() => contents.publish(adminId('tech01'), draft.id));
    expect(err.code).toBe(ErrorCode.CONFLICT);
    expect(err.message).toBe('当前状态为草稿，不能直接发布');

    // 草稿不能审核通过 / 退回 / 下线
    expect(caught(() => contents.approve(adminId('clinician01'), draft.id)).message).toBe(
      '当前状态为草稿，不能审核通过',
    );
    expect(caught(() => contents.reject(adminId('clinician01'), draft.id, { comment: 'x' })).message).toBe(
      '当前状态为草稿，不能退回修改',
    );
    expect(caught(() => contents.takeOffline(adminId('tech01'), draft.id)).message).toBe(
      '当前状态为草稿，不能一键下线',
    );

    // 待医学审核不能直接发布
    contents.submitForReview(adminId('editor01'), draft.id, {});
    err = caught(() => contents.publish(adminId('tech01'), draft.id));
    expect(err.code).toBe(ErrorCode.CONFLICT);
    expect(err.message).toBe('当前状态为待医学审核，不能直接发布');

    // 已审定不能重复提交审核
    contents.approve(adminId('clinician01'), draft.id, {});
    expect(caught(() => contents.submitForReview(adminId('editor01'), draft.id)).message).toBe(
      '当前状态为已审定，不能提交审核',
    );

    // 已发布不能直接发布 / 提交审核
    const published = contents.publish(adminId('tech01'), draft.id);
    expect(published.current_status).toBe('已发布');
    err = caught(() => contents.submitForReview(adminId('editor01'), draft.id));
    expect(err.code).toBe(ErrorCode.CONFLICT);
    expect(err.message).toBe('当前状态为已发布，不能提交审核');
    expect(caught(() => contents.publish(adminId('tech01'), draft.id)).message).toBe(
      '当前状态为已发布，不能直接发布',
    );

    // 更正中不能直接发布
    contents.markCorrecting(adminId('clinician01'), draft.id, { reason: '需要更正' });
    expect(caught(() => contents.publish(adminId('tech01'), draft.id)).message).toBe(
      '当前状态为更正中，不能直接发布',
    );

    // 退回必须写意见（40000）
    const d2 = contents.createDraft(adminId('editor01'), draftInput('测试：退回需写意见'));
    contents.submitForReview(adminId('editor01'), d2.id, {});
    expect(caught(() => contents.reject(adminId('clinician01'), d2.id, { comment: '   ' })).code).toBe(
      ErrorCode.BAD_REQUEST,
    );
  });

  it('双人确认：审定人与发布人是同一人时拒绝，换人后可发布', async () => {
    const draft = contents.createDraft(adminId('editor01'), draftInput('测试：双人确认'));
    contents.submitForReview(adminId('editor01'), draft.id, {});
    contents.approve(adminId('clinician01'), draft.id, {});

    // 审定人（clinician01）自己发布 → 40900
    const err = caught(() => contents.publish(adminId('clinician01'), draft.id));
    expect(err.code).toBe(ErrorCode.CONFLICT);
    expect(err.message).toContain('发布需双人确认');

    // 状态未被改动，换一位临床审核角色发布 → 通过
    const after = contents.publish(adminId('super01'), draft.id);
    expect(after.current_status).toBe('已发布');
    expect(after.review_records.map((r) => r.decision)).toContain('发布');
  });

  it('退回修改：记录意见并回到草稿，可修改后重新提交', async () => {
    const draft = contents.createDraft(adminId('editor01'), draftInput('测试：退回修改'));
    contents.submitForReview(adminId('editor01'), draft.id, { evidence: '依据：指南' });
    const rejected = contents.reject(adminId('clinician01'), draft.id, { comment: '脚本缺少依据，请补充' });
    expect(rejected.current_status).toBe('草稿');
    const back = rejected.review_records.find((r) => r.decision === '退回')!;
    expect(back.comment).toBe('脚本缺少依据，请补充');
    expect(back.reviewer_name).toBe('clinician01');

    // 修改草稿后重新提交
    const updated = contents.updateDraft(adminId('editor01'), draft.id, { script: '补充依据后的脚本' });
    expect(updated.versions[0].script).toBe('补充依据后的脚本');
    const resubmitted = contents.submitForReview(adminId('editor01'), draft.id, {});
    expect(resubmitted.current_status).toBe('待医学审核');
    // 待医学审核不能再编辑草稿
    expect(caught(() => contents.updateDraft(adminId('editor01'), draft.id, { title: 'x' })).message).toBe(
      '当前状态为待医学审核，不能编辑草稿内容',
    );
  });

  // ---------- 下线与更正中 ----------

  it('一键下线：设置下线开关与已下线状态、返回引用定位信息，用户端立即 404 且列表不含该内容', async () => {
    // 种子中的一页分析引用了「看懂腰椎 MRI 报告：L5/S1 是什么」
    const target = (await list()).find((c) => c.title === '看懂腰椎 MRI 报告：L5/S1 是什么')!;
    expect(target).toBeTruthy();
    // 下线前用户端可见
    expect((await detailOf(target.id)).current_version).toBeTruthy();

    const result = contents.takeOffline(adminId('tech01'), target.id, { reason: '演示一键下线' });
    expect(result.content.current_status).toBe('已下线');
    expect(result.content.offline).toBe(true);

    // 引用定位信息：来自 analysis.sections.videos 的 content_item_id
    expect(result.references.count).toBeGreaterThan(0);
    expect(
      result.references.analyses.some((a) => a.videos.some((v) => v.content_item_id === target.id)),
    ).toBe(true);

    // 下线立即生效：详情 404、列表不含
    const after = await api().get(`/contents/${target.id}`).set(H());
    expect(after.body.code).toBe(40400);
    expect((await list()).some((c) => c.id === target.id)).toBe(false);

    // 下线记录写入审核记录与审计
    const rec = db.app
      .prepare(`SELECT decision, comment FROM review_record WHERE target_id=? AND decision='下线'`)
      .get(target.id) as { comment: string } | undefined;
    expect(rec).toBeTruthy();
    expect(JSON.parse(rec!.comment).reason).toBe('演示一键下线');
    const audit = db.app
      .prepare(`SELECT action, diff FROM audit_log WHERE target=? AND action='content.offline'`)
      .get(`content_item:${target.id}`) as { diff: string } | undefined;
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit!.diff).reference_count).toBeGreaterThan(0);
  });

  it('更正中闭环：已发布 → 更正中 → 提交新版本 → 已审定 → 发布新版本号', async () => {
    const draft = contents.createDraft(adminId('editor01'), draftInput('测试：更正中闭环'));
    contents.submitForReview(adminId('editor01'), draft.id, {});
    contents.approve(adminId('clinician01'), draft.id, {});
    const first = contents.publish(adminId('tech01'), draft.id);
    expect(first.current_version!.version).toBe(1);

    // 已发布 → 更正中（用户端立即可见性消失）
    const correcting = contents.markCorrecting(adminId('clinician01'), draft.id, { reason: '示例动作有争议' });
    expect(correcting.current_status).toBe('更正中');
    expect((await api().get(`/contents/${draft.id}`).set(H())).body.code).toBe(40400);

    // 提交新版本（版本号 +1）→ 待医学审核 → 已审定 → 发布
    const resubmitted = contents.resubmit(adminId('editor01'), draft.id, {
      script: '第二版：调整动作幅度并补充安全提示',
      subtitle_text: '字幕：任何动作以不加重症状为前提',
      evidence: '依据：随机对照试验（演示）',
    });
    expect(resubmitted.current_status).toBe('待医学审核');
    expect(resubmitted.versions.map((v) => v.version)).toEqual([1, 2]);

    contents.approve(adminId('clinician01'), resubmitted.id, {});
    const republished = contents.publish(adminId('super01'), resubmitted.id);
    expect(republished.current_status).toBe('已发布');
    expect(republished.current_version!.version).toBe(2);
    expect(republished.current_version!.script).toContain('第二版');
    // 版本链保留两版，只有 v2 是当前版本
    expect(republished.versions.filter((v) => v.is_current).map((v) => v.version)).toEqual([2]);
    // 用户端恢复可见，详情给出版本链
    const d = await detailOf(draft.id);
    expect(d.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(d.current_version!.version).toBe(2);
  });

  it('已撤回 / 已下线 → 更正中（修订后重审）', async () => {
    // 已撤回
    const draft = contents.createDraft(adminId('editor01'), draftInput('测试：撤回后重审'));
    contents.submitForReview(adminId('editor01'), draft.id, {});
    contents.approve(adminId('clinician01'), draft.id, {});
    contents.publish(adminId('tech01'), draft.id);
    const withdrawn = contents.withdraw(adminId('clinician01'), draft.id, { reason: '发现严重问题' });
    expect(withdrawn.current_status).toBe('已撤回');
    expect((await api().get(`/contents/${draft.id}`).set(H())).body.code).toBe(40400);
    expect(contents.markCorrecting(adminId('editor01'), draft.id, {}).current_status).toBe('更正中');

    // 已下线
    const draft2 = contents.createDraft(adminId('editor01'), draftInput('测试：下线后重审'));
    contents.submitForReview(adminId('editor01'), draft2.id, {});
    contents.approve(adminId('clinician01'), draft2.id, {});
    contents.publish(adminId('tech01'), draft2.id);
    const offline = contents.takeOffline(adminId('tech01'), draft2.id, {});
    expect(offline.content.current_status).toBe('已下线');
    expect(offline.content.offline).toBe(true);
    expect(contents.markCorrecting(adminId('editor01'), draft2.id, {}).current_status).toBe('更正中');
  });
});
