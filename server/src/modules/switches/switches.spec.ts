import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { DbModule } from '../../db/db.module';
import { DbService } from '../../db/db.service';
import { SchemaService } from '../../db/schema.service';
import { AuditService } from '../../common/audit.service';
import { SwitchesService, SWITCH_KEYS } from './switches.service';
import { SwitchesController } from './switches.controller';
import { buildFallbackSections } from '../analyses/fallback';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { AllExceptionsFilter } from '../../common/all-exceptions.filter';

describe('T04 功能开关与回退', () => {
  let app: INestApplication;
  let switches: SwitchesService;
  let audit: AuditService;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-switch-'));
    process.env.DB_DIR = dir;
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
      controllers: [SwitchesController],
      providers: [AuditService, SwitchesService, SchemaService],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    switches = app.get(SwitchesService);
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const getDb = () => app.get(DbService) as { app: import('node:sqlite').DatabaseSync };

  it('GET /switches 公开返回四个开关', async () => {
    const res = await request(app.getHttpServer()).get('/switches').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.map((s: { key: string }) => s.key)).toEqual([...SWITCH_KEYS]);
  });

  it('默认值：个性化分析与视频推荐开启，拍照提取与案例卡片关闭', () => {
    expect(switches.isEnabled('个性化分析')).toBe(true);
    expect(switches.isEnabled('视频推荐')).toBe(true);
    expect(switches.isEnabled('拍照提取')).toBe(false);
    expect(switches.isEnabled('案例卡片')).toBe(false);
  });

  it('关闭个性化分析后立即生效，且变更写审计（哈希链可校验）', () => {
    const before = (getDb().app.prepare('SELECT COUNT(*) n FROM audit_log').get() as { n: number }).n;
    switches.setEnabled('个性化分析', false, '演示：临时关闭', 'actor-1');
    expect(switches.isEnabled('个性化分析')).toBe(false);

    const rows = getDb().app.prepare('SELECT * FROM audit_log').all() as Record<string, unknown>[];
    expect(rows.length).toBe(before + 1);
    const last = rows[rows.length - 1];
    expect(last.action).toBe('switch.update');
    expect(String(last.target)).toContain('个性化分析');
    expect(audit.verifyChain().ok).toBe(true);

    // 重新开启后恢复
    switches.setEnabled('个性化分析', true, '演示：恢复', 'actor-1');
    expect(switches.isEnabled('个性化分析')).toBe(true);
    expect(audit.verifyChain().ok).toBe(true);
  });

  it('未知开关名称被拒绝', () => {
    expect(() => switches.setEnabled('不存在的开关', true, 'x', null)).toThrow();
  });

  it('关闭个性化分析时分析接口走回退结果（保留已录入信息、明确说明原因）', () => {
    switches.setEnabled('个性化分析', false, '演示：回退路径', 'actor-1');
    const sections = buildFallbackSections({
      episode_title: '久坐后腰痛',
      events: [
        {
          event_type: '症状',
          source_type: '自述',
          raw_text: '久坐 4 小时后腰部酸痛',
          occurred_at: '2026-07-18T09:00:00.000Z',
          verify_status: '已确认',
        },
        {
          event_type: '症状',
          source_type: '自述',
          raw_text: null,
          occurred_at: '2026-09-10T09:00:00.000Z',
          verify_status: '尚未确认',
        },
      ],
      reason: 'switch_off',
    });
    expect(sections.meta.fallback).toBe(true);
    expect(sections.meta.disclaimer).toContain('个性化分析当前已关闭');
    expect(sections.explain).toHaveLength(0);
    expect(sections.known).toHaveLength(2);
    expect(sections.known[0].source).toBe('自述');
    expect(sections.unknown.join('')).toContain('尚未确认');
    // 回退仍指向已审核资料与就医提示
    expect(sections.next.map((n) => n.type)).toContain('资料');
    expect(sections.next.map((n) => n.type)).toContain('就医提示');
    switches.setEnabled('个性化分析', true, '演示：恢复', 'actor-1');
  });
});
