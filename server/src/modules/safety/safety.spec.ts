import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { SchemaService } from '../../db/schema.service';
import { SafetyService } from './safety.service';
import { RED_FLAG_RULES, OUT_OF_SCOPE_RULES, RULE_SET_VERSION } from './safety.rules';

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
      ['RF-04', '摔倒后腰痛越来越重'],
      ['RF-05', '腰痛并且发热'],
      ['RF-06', '体重下降伴腰痛'],
      ['RF-07', '有肿瘤病史，新发腰痛'],
    ];
    for (const [code, text] of cases) {
      const r = safety.checkRedFlags({ texts: [text] });
      expect(r.matched.map((m) => m.rule_code)).toContain(code);
    }
    // 规则编号连续且带版本
    expect(RED_FLAG_RULES.map((r) => r.code)).toEqual([
      'RF-01', 'RF-02', 'RF-03', 'RF-04', 'RF-05', 'RF-06', 'RF-07',
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
    expect(OUT_OF_SCOPE_RULES.map((r) => r.category)).toEqual(['诊断', '手术', '用药']);
  });

  it('evaluateQuestion 合并范围校验与红旗校验', () => {
    const r = safety.evaluateQuestion('我是不是椎间盘突出，最近还双腿进行性无力', userId);
    expect(r.out_of_scope?.category).toBe('诊断');
    expect(r.safety_flag).toBe('stop_personal');
  });
});
