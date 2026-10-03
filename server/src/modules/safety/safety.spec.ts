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
  normalizeSafetyText,
} from './safety.rules';
import { NORMAL_REPORTS, SHOULD_NOT_TRIGGER, SHOULD_TRIGGER } from './safety.corpus';

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
      ['RF-10', '腰疼得受不了'],
    ];
    for (const [code, text] of cases) {
      const r = safety.checkRedFlags({ texts: [text] });
      expect(r.matched.map((m) => m.rule_code)).toContain(code);
    }
    // 规则编号连续且带版本
    expect(RED_FLAG_RULES.map((r) => r.code)).toEqual([
      'RF-01', 'RF-02', 'RF-03', 'RF-04', 'RF-05', 'RF-06', 'RF-07', 'RF-08', 'RF-09', 'RF-10',
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

  it('服务范围校验：诊断 / 手术 / 用药 / 治疗 / 预后越界明确不答并转为复诊问题', () => {
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
    expect(OUT_OF_SCOPE_RULES.map((r) => r.category)).toEqual(['诊断', '手术', '用药', '治疗', '预后']);
  });

  it('evaluateQuestion 合并范围校验与红旗校验', () => {
    const r = safety.evaluateQuestion('我是不是椎间盘突出，最近还双腿进行性无力', userId);
    expect(r.out_of_scope?.category).toBe('诊断');
    expect(r.safety_flag).toBe('stop_personal');
  });
});

describe('T04b 红旗说法覆盖面（验收反馈：口语 / 错别字 / 语序变化都要命中）', () => {
  const flagged = (text: string) =>
    RED_FLAG_RULES.filter((r) => matchesRedFlagRule(r, text)).map((r) => r.code);

  it('自编口语说法逐条命中', () => {
    const cases: [string, string][] = [
      ['RF-03', '昨晚不小心尿裤子了自己都没感觉到'],
      ['RF-03', '大便失控了两回'],
      ['RF-03', '屎尿都兜不住了'],
      ['RF-03', '小便失噤好几次了'],
      ['RF-03', '这两天憋不住尿裤子都湿了'],
      ['RF-03', '大便拉在身上了自己没察觉'],
      ['RF-01', '屁股中间那块麻麻的没感觉'],
      ['RF-01', '屁股中间那一圈摸着没感觉了'],
      ['RF-01', '坐马桶的时候屁股底下像隔了一层布'],
      ['RF-02', '左脚背翘不起来了'],
      ['RF-02', '右脚抬不起来走路拖着脚'],
      ['RF-02', '双下肢肌力进行性下降'],
      ['RF-02', '腿麻木无力加重了'],
      ['RF-02', '双腿突然没力气站不起来'],
      ['RF-06', '腰疼还一直发高烧39度'],
      ['RF-07', '我三年前得过乳腺癌'],
      ['RF-07', '有肺癌病史最近腰痛越来越重'],
      ['RF-05', '没减肥体重却掉了七八公斤'],
      ['RF-10', '疼得受不了'],
      ['RF-10', '腰疼得死去活来'],
      ['RF-04', '夜里疼得睡不着'],
      ['RF-09', '走路越来越不稳'],
    ];
    for (const [code, text] of cases) {
      expect(flagged(text)).toContain(code);
    }
  });

  it('书面 / 口语 / 错别字基础说法命中', () => {
    const cases: [string, string][] = [
      ['RF-01', '会阴部发麻'],
      ['RF-01', '会阴区或鞍区麻木'],
      ['RF-01', '屁股有点麻'],
      ['RF-01', '会音麻木'],
      ['RF-01', '肛门周围发木'],
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
      '会阴部没有麻木，大小便也正常',
      '会阴部没有麻木，大小便也正常，可以正常上班',
      '孩子发烧了我请假在家照顾腰有点酸',
      '我老婆前几天发烧了我腰有点疼',
      '弟弟摔了一跤我自己腰痛是久坐引起的',
      '门诊记录：……无大小便异常，会阴区无麻木，下肢无进行性无力。诊断：腰肌劳损。',
      '患者否认大小便失禁及会阴部麻木，查体未见异常，诊断：腰肌劳损。',
      '腰椎 MRI 平扫：腰椎序列正常，生理曲度存在，L4/5 椎间盘轻度退变。',
      '影像所见：硬膜囊前脂肪间隙清晰，双侧椎间孔未见明显狭窄。',
      '大小便正常，无排尿排便困难',
      '下肢肌力正常，病理征阴性',
      '无压痛，无叩击痛，活动度可',
      '疼痛VAS 3分，卧床休息后可缓解',
    ];
    for (const text of negatives) {
      expect(flagged(text)).toEqual([]);
    }
  });

  it('越界提问：诊断 / 手术 / 用药 / 治疗 / 预后都要拒答', () => {
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-01')!, '我是不是腰椎间盘突出症？')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-01')!, '帮我确定一下是哪种病')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-01')!, '这算不算坐骨神经痛')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-01')!, '我这是腰肌劳损还是突出')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-03')!, '我要不要去打封闭针')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-03')!, '可以贴膏药吗，贴哪种好')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-04')!, '我不会瘫痪吧')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-04')!, '我多久能好')).toBe(true);
    expect(matchesScopeRule(OUT_OF_SCOPE_RULES.find((r) => r.code === 'OOS-04')!, '以后会不会复发')).toBe(true);
    // 范围内的问题放行
    expect(OUT_OF_SCOPE_RULES.some((r) => matchesScopeRule(r, '我能不能多坐一会儿？'))).toBe(false);
    expect(OUT_OF_SCOPE_RULES.some((r) => matchesScopeRule(r, '报告里写的 L5/S1 是什么意思？'))).toBe(false);
  });

  it('求保证类说法识别（含「是不是没什么大事」）', () => {
    expect(isWorryLoop('不会瘫痪吧')).toBe(true);
    expect(isReassurance('是不是没什么大事')).toBe(true);
    expect(isReassurance('我这应该没什么大事吧')).toBe(true);
    expect(normalizeSafetyText('大小便失禁')).toBe('大小便失禁');
    expect(REASSURANCE_STREAK).toBe(3);
  });
});

describe('T04c 自编语料逐条核对（第六轮验收反馈：换一种说法也要命中，普通腰腿痛不能误判）', () => {
  const flagged = (text: string) =>
    RED_FLAG_RULES.filter((r) => matchesRedFlagRule(r, text)).map((r) => r.code);

  it('应触发说法全部命中（口语 / 方言 / 错别字 / 语序变化）', () => {
    const misses = SHOULD_TRIGGER.filter((c) => !flagged(c.text).includes(c.rule));
    expect(misses.map((m) => `${m.rule} ${m.text}`)).toEqual([]);
    expect(SHOULD_TRIGGER.length).toBeGreaterThanOrEqual(50);
  });

  it('普通腰腿痛 / 日常 / 否定 / 第三方 / 报告原文不误判', () => {
    const ordinary = SHOULD_NOT_TRIGGER.filter((t) => /腰|腿|屁股/.test(t));
    // 普通腰腿痛加重 / 发麻 / 放射痛说法不少于 20 条
    expect(ordinary.length).toBeGreaterThanOrEqual(20);
    const wrong = [...SHOULD_NOT_TRIGGER, ...NORMAL_REPORTS].filter((t) => flagged(t).length > 0);
    expect(wrong).toEqual([]);
    expect(NORMAL_REPORTS.length).toBeGreaterThanOrEqual(10);
  });

  it('A02 关键变化确认的选项文案必须命中对应红旗规则', () => {
    expect(flagged('大小便控制变化')).toContain('RF-03');
    expect(flagged('会阴部麻木')).toContain('RF-01');
    expect(flagged('双腿进行性无力')).toContain('RF-02');
    expect(flagged('腰痛伴发热')).toContain('RF-06');
  });

  it('换一种说法的越界提问仍然明确拒答', () => {
    const oos = (code: string, q: string) =>
      matchesScopeRule(
        OUT_OF_SCOPE_RULES.find((r) => r.code === code)!,
        q,
      );
    expect(oos('OOS-01', '我这是不是神经根型的')).toBe(true);
    expect(oos('OOS-01', '照片子看我是L5压迫吗')).toBe(true);
    expect(oos('OOS-01', '有没有可能是肾结石引起的腰疼')).toBe(true);
    expect(oos('OOS-02', '这种情况要住院吗')).toBe(true);
    expect(oos('OOS-03', '扶他林软膏一天抹几次')).toBe(true);
    expect(oos('OOS-03', '乙哌立松可以长期吃吗')).toBe(true);
    expect(oos('OOS-04', '半年后能不能跑马拉松')).toBe(true);
    expect(oos('OOS-04', '我还能不能正常工作到退休')).toBe(true);
    expect(oos('OOS-04', '老了会不会瘫在床上')).toBe(true);
    expect(oos('OOS-04', '过两周能好利索不')).toBe(true);
    expect(oos('OOS-05', '我需要卧床休息几周')).toBe(true);
    expect(oos('OOS-05', '推拿能不能把突出的地方按回去')).toBe(true);
    // 范围内的问题放行
    expect(OUT_OF_SCOPE_RULES.some((r) => matchesScopeRule(r, '报告里写的 L5/S1 是什么意思'))).toBe(false);
    expect(OUT_OF_SCOPE_RULES.some((r) => matchesScopeRule(r, '我昨天走了六千步，腰有点酸'))).toBe(false);
  });

  it('「不会瘫痪吧」走求保证循环；「会不会坐轮椅」走越界拒答（第七轮第 9 条）', () => {
    // 否定式求助（「不会…吧」）走求保证循环，不做一次越界拒答
    expect(isReassurance('不会瘫痪吧')).toBe(true);
    expect(isReassurance('不会坐轮椅吧')).toBe(true);
    expect(isWorryLoop('大概几周能恢复正常上班')).toBe(true);
    // 预后类提问（「会不会…」）走越界拒答并转复诊问题，不再被求保证话术接住
    expect(isReassurance('会不会以后要坐轮椅')).toBe(false);
    expect(isReassurance('再过几年会不会更严重')).toBe(false);
    const prognosis = OUT_OF_SCOPE_RULES.find((r) => r.category === '预后')!;
    expect(matchesScopeRule(prognosis, '会不会以后要坐轮椅')).toBe(true);
    expect(matchesScopeRule(prognosis, '再过几年会不会更严重')).toBe(true);
  });
});
