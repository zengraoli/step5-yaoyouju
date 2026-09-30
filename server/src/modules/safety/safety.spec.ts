import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { SchemaService } from '../../db/schema.service';
import { SafetyService } from './safety.service';
import {
  RED_FLAG_RULES,
  OUT_OF_SCOPE_RULES,
  RULE_SET_VERSION,
  matchesRedFlagRule,
  matchesScopeRule,
  isReassurance,
  isWorryLoop,
  REASSURANCE_STREAK,
} from './safety.rules';

describe('T04 安全规则引擎', () => {
  let app: INestApplication;
  let safety: SafetyService;
  let dir: string;
  const userId = 'u-test';

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-safety-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      providers: [SafetyService, SchemaService],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    safety = app.get(SafetyService);
    // 造一个用户供安全事件外键使用
    const db = app.get(DbService) as { app: import('node:sqlite').DatabaseSync };
    db.app
      .prepare('INSERT INTO users (id, status, created_at) VALUES (?, ?, ?)')
      .run(userId, 'active', new Date().toISOString());
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const getDb = () => app.get(DbService) as { app: import('node:sqlite').DatabaseSync };

  it('每条红旗规则都能命中自己的症状描述', () => {
    const cases: [string, string][] = [
      ['RF-01', '坐下时会阴部麻木'],
      ['RF-02', '最近双腿进行性无力'],
      ['RF-03', '这两天大小便控制困难'],
      ['RF-04', '夜间痛持续不缓解'],
      ['RF-05', '体重三个月掉了10斤'],
      ['RF-06', '腰痛并且发热'],
      ['RF-07', '有肿瘤病史，新发腰痛'],
      ['RF-08', '摔了一跤后腰痛加重'],
      ['RF-09', '左脚背发麻'],
    ];
    for (const [code, text] of cases) {
      const r = safety.checkRedFlags({ texts: [text] });
      expect(r.matched.map((m) => m.rule_code)).toContain(code);
    }
    // 规则编号连续且带版本
    expect(RED_FLAG_RULES.map((r) => r.code)).toEqual([
      'RF-01', 'RF-02', 'RF-03', 'RF-04', 'RF-05', 'RF-06', 'RF-07', 'RF-08', 'RF-09',
    ]);
    expect(RULE_SET_VERSION).toMatch(/^safety-rules-v\d/);
  });

  it('high 级命中 → 停止个性化分析；medium 级 → 提示就医；无命中 → none', () => {
    const high = safety.checkRedFlags({ texts: ['会阴部麻木，排便无力'] });
    expect(high.safety_flag).toBe('stop_personal');
    expect(high.matched[0].action).toBe('停止个性化分析');

    const medium = safety.checkRedFlags({ texts: ['腰痛伴发热两天'] });
    expect(medium.safety_flag).toBe('seek_care');
    expect(medium.matched[0].action).toBe('提示就医');

    const none = safety.checkRedFlags({ texts: ['久坐后腰痛，起身可缓解'] });
    expect(none.safety_flag).toBe('none');
    expect(none.matched).toHaveLength(0);
  });

  it('命中红旗写安全事件（规则、严重度、动作、来源）', () => {
    const before = (getDb().app.prepare('SELECT COUNT(*) n FROM safety_event').get() as { n: number }).n;
    safety.checkRedFlags({ user_id: userId, texts: ['双腿进行性无力，走路越来越没劲'] });
    const rows = getDb().app
      .prepare('SELECT rule_code, severity, action_taken FROM safety_event ORDER BY created_at DESC')
      .all() as { rule_code: string; severity: string; action_taken: string }[];
    expect(rows.length).toBeGreaterThan(before);
    expect(rows[0].rule_code).toBe('RF-02');
    expect(rows[0].severity).toBe('high');
    expect(rows[0].action_taken).toBe('停止个性化分析');
  });

  it('不写安全事件时也不产生记录（无 user_id）', () => {
    const before = (getDb().app.prepare('SELECT COUNT(*) n FROM safety_event').get() as { n: number }).n;
    safety.checkRedFlags({ texts: ['会阴部麻木'] });
    const after = (getDb().app.prepare('SELECT COUNT(*) n FROM safety_event').get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it('服务范围校验：诊断 / 手术 / 用药越界明确不答并转为复诊问题', () => {
    const diag = safety.checkScope('我是不是椎间盘突出了？');
    expect(diag?.category).toBe('诊断');
    expect(diag?.reply).toContain('不能判断');
    expect(diag?.followup_question).toContain('请医生');

    const surgery = safety.checkScope('需不需要做微创手术？');
    expect(surgery?.category).toBe('手术');
    expect(surgery?.reply).toContain('不能给出手术建议');

    const med = safety.checkScope('吃什么止疼药好？');
    expect(med?.category).toBe('用药');
    expect(med?.reply).toContain('不能提供用药');

    // 范围内问题放行
    expect(safety.checkScope('报告里写的 L5/S1 是什么意思？')).toBeNull();
    expect(OUT_OF_SCOPE_RULES.map((r) => r.category)).toEqual(['诊断', '手术', '用药', '预后']);
  });

  it('evaluateQuestion 合并范围校验与红旗校验', () => {
    const r = safety.evaluateQuestion('我是不是椎间盘突出，最近还双腿进行性无力', userId);
    expect(r.out_of_scope?.category).toBe('诊断');
    expect(r.safety_flag).toBe('stop_personal');
  });
});

describe('T04b 红旗说法的否定识别（验收反馈第 2 条）', () => {
  const flagged = (text: string) =>
    RED_FLAG_RULES.filter((r) => matchesRedFlagRule(r, text)).map((r) => r.code);

  it('口语 / 错别字 / App 文案里的红旗说法都要命中', () => {
    const cases: [string, string][] = [
      ['RF-01', '会阴部发麻'],
      ['RF-01', '会阴区或鞍区麻木'],
      ['RF-01', '屁股有点麻'],
      ['RF-01', '会音麻木'],
      ['RF-03', '尿不出来'],
      ['RF-02', '腿越来越没力气'],
      ['RF-02', '两条腿越来越没劲'],
      ['RF-02', '双退无力'],
      ['RF-03', '解不出小便'],
      ['RF-03', '大便憋不住'],
      ['RF-03', '大小便失禁'],
      ['RF-03', '大小变失禁'],
      ['RF-03', '大小便控制异常'],
      ['RF-04', '夜间痛持续不缓解'],
      ['RF-04', '发热、夜间痛持续不缓解或体重明显下降'],
      ['RF-05', '体重三个月掉了10斤'],
      ['RF-05', '体重明显下降'],
      ['RF-06', '发热'],
      ['RF-07', '有肿瘤病史，新发腰痛'],
      ['RF-08', '摔了一跤后腰痛加重'],
      ['RF-09', '左脚背发麻'],
    ];
    for (const [code, text] of cases) {
      expect(flagged(text)).toContain(code);
    }
  });

  it('否定说法与正常描述不能误判为红旗', () => {
    const negatives = [
      '没有大小便失禁',
      '大小便控制良好',
      '双腿没有无力',
      '双腿力量正常',
      '双腿无麻木无力',
      '没有发烧，腰痛久坐后加重',
      '大小便控制正常，会阴部感觉正常，双腿肌力正常',
      '没有夜间痛',
      '报告未见会阴部麻木',
      '否认大小便失禁',
      '无发热',
      '蹲久了腿有点酸',
      '三个月前来过',
      '久坐 4 小时后腰痛，起身活动可缓解',
    ];
    for (const text of negatives) {
      expect(flagged(text)).toEqual([]);
    }
  });

  it('越界提问：诊断 / 手术 / 用药 / 预后都要拒答', () => {
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-01')!, '我是不是腰椎间盘突出症？')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-01')!, '帮我确定一下是哪种病')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-03')!, '我要不要去打封闭针')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-03')!, '塞来昔布一天吃两次可以吗')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-04')!, '我不会瘫痪吧')).toBe(true);
    // 范围内的问题放行
    expect(OUT_OF_SCOPE_RULES.some((r) => matchesScopeRule(r, '我能不能多坐一会儿？'))).toBe(false);
    expect(OUT_OF_SCOPE_RULES.some((r) => matchesScopeRule(r, '报告里写的 L5/S1 是什么意思？'))).toBe(false);
  });

  it('连续 4 次问「不会瘫痪吧」会结束本轮', () => {
    expect(isWorryLoop('不会瘫痪吧')).toBe(true);
    expect(REASSURANCE_STREAK).toBe(3);
  });
});
