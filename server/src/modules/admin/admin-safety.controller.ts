import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from './admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { DbService } from '../../db/db.service';
import { SwitchesService, SWITCH_KEYS } from '../switches/switches.service';
import { HIGH_RISK_SWITCHES, hasPermission } from './admin.constants';
import { ApiException, ErrorCode } from '../../common/api-error';
import { RED_FLAG_RULES, OUT_OF_SCOPE_RULES, RULE_SET_VERSION } from '../safety/safety.rules';

class UpdateSwitchDto {
  @ApiProperty({ description: '是否开启' })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ description: '变更原因（写审计）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

void IsIn;

/** 安全事件与应急开关（B07） */
@ApiTags('admin-safety')
@Controller('admin/safety')
export class AdminSafetyController {
  constructor(
    private readonly db: DbService,
    private readonly switches: SwitchesService,
  ) {}

  @ApiOperation({ summary: '安全事件列表（规则 / 严重度 / 时间筛选）' })
  @Get('events')
  events(
    @Query('rule') rule?: string,
    @Query('severity') severity?: string,
    @Query('hours') hours?: string,
    @Query('limit') limit?: string,
  ) {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (rule && rule !== '全部') {
      where.push('rule_code = ?');
      params.push(rule);
    }
    if (severity && severity !== '全部') {
      where.push('severity = ?');
      params.push(severity);
    }
    const h = hours ? Number(hours) : 24 * 7;
    if (Number.isFinite(h) && h > 0) {
      where.push('created_at >= ?');
      params.push(new Date(Date.now() - h * 3600 * 1000).toISOString());
    }
    const sql = `SELECT id, user_id, rule_code, severity, action_taken, created_at FROM safety_event ${
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY created_at DESC LIMIT ?`;
    params.push(Math.min(200, Math.max(1, limit ? Number(limit) : 50)));
    const rows = this.db.app.prepare(sql).all(...params) as {
      id: string;
      user_id: string;
      rule_code: string;
      severity: string;
      action_taken: string;
      created_at: string;
    }[];
    const total = rows.length;
    const bySeverity = { high: 0, medium: 0, low: 0 };
    for (const r of rows) {
      if (r.severity === 'high') bySeverity.high += 1;
      else if (r.severity === 'medium') bySeverity.medium += 1;
      else bySeverity.low += 1;
    }
    return {
      items: rows.map((r) => ({
        id: r.id,
        rule_code: r.rule_code,
        severity: r.severity,
        action: r.action_taken,
        source: '当前情况确认 / 问与解释',
        user_masked: `U-${r.user_id.slice(0, 4).toUpperCase()}…`,
        created_at: r.created_at,
      })),
      total,
      by_severity: bySeverity,
      window_hours: h,
    };
  }

  @ApiOperation({ summary: '红旗规则集（版本 + 规则列表；只显示匿名标识与规则动作）' })
  @Get('rules')
  rules() {
    return {
      rule_set_version: RULE_SET_VERSION,
      red_flags: RED_FLAG_RULES.map((r) => ({
        code: r.code,
        label: r.label,
        severity: r.severity,
        action: r.action,
        advice: r.advice,
      })),
      out_of_scope: OUT_OF_SCOPE_RULES.map((r) => ({
        code: r.code,
        category: r.category,
        reply: r.reply,
        followup_question: r.followup_question,
      })),
      note: '规则以版本管理；每次评估记录所用版本。变更需临床负责人签署并触发回归评测（危险遗漏 = 0 才可生效）。规则引擎不可用时拒绝创建分析并始终显示静态就医提示。',
    };
  }

  @ApiOperation({ summary: '应急开关列表（含确认要求与最近变更）' })
  @Get('switches')
  switchList() {
    const list = this.switches.list();
    // 最近变更（审计日志）
    const lastChange = (key: string) => {
      const row = this.db.app
        .prepare(
          `SELECT diff, created_at FROM audit_log WHERE action = 'switch.update' AND target = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(`feature_switch:${key}`) as { diff: string | null; created_at: string } | undefined;
      if (!row) return null;
      let actor = '—';
      try {
        const diff = row.diff ? JSON.parse(row.diff) : {};
        actor = diff.reason ?? '—';
      } catch {
        actor = '—';
      }
      return { at: row.created_at.slice(0, 10), by: actor };
    };
    const requirements: Record<string, string> = {
      个性化分析: '双人',
      视频推荐: '单人 + 原因',
      拍照提取: '单人',
      案例卡片: '双人',
    };
    return list.map((s) => ({
      key: s.key,
      enabled: s.enabled,
      reason: s.reason,
      updated_at: s.updated_at,
      requirement: requirements[s.key] ?? '单人',
      last_change: lastChange(s.key),
    }));
  }

  @ApiOperation({ summary: '变更应急开关（立即生效，写审计；高危开关需 switch.manage）' })
  @RequirePermission('switch.manage_low')
  @Put('switches/:key')
  updateSwitch(
    @CurrentAdmin() admin: AdminContext,
    @Param('key') key: string,
    @Body() dto: UpdateSwitchDto,
  ) {
    if (!SWITCH_KEYS.includes(key as (typeof SWITCH_KEYS)[number])) {
      throw new (class extends Error {})(`开关名称必须是：${SWITCH_KEYS.join(' / ')}`);
    }
    // 高危开关（个性化分析）只允许技术负责人 / 超级管理变更（B10：临床审核仅非高危）
    if (HIGH_RISK_SWITCHES.includes(key) && !hasPermission(admin.permissions, 'switch.manage')) {
      throw new ApiException(ErrorCode.FORBIDDEN, '高危开关变更需要技术负责人或超级管理员');
    }
    return this.switches.setEnabled(key, dto.enabled, dto.reason?.trim() || '后台变更', admin.id);
  }

  @ApiOperation({ summary: '事故记录（由审计日志派生：下线 / 回滚 / 开关变更）' })
  @Get('incidents')
  incidents() {
    const rows = this.db.app
      .prepare(
        `SELECT id, actor_id, action, target, diff, created_at FROM audit_log
         WHERE action IN ('content.offline', 'model.rollback', 'switch.update', 'evidence.deactivate')
         ORDER BY created_at DESC LIMIT 20`,
      )
      .all() as { id: string; actor_id: string | null; action: string; target: string | null; diff: string | null; created_at: string }[];
    const actionLabels: Record<string, string> = {
      'content.offline': '内容下线',
      'model.rollback': '模型回滚',
      'switch.update': '开关变更',
      'evidence.deactivate': '证据停用',
    };
    return rows.map((r, i) => {
      let summary = actionLabels[r.action] ?? r.action;
      try {
        const diff = r.diff ? JSON.parse(r.diff) : {};
        if (r.action === 'content.offline') summary = `内容已下线 → 更正中 · 复盘完成`
        if (r.action === 'model.rollback') summary = `模型发布已回滚 · 加入评测集 · 复盘完成`
        if (r.action === 'switch.update') summary = `开关变更：${diff.key ?? ''} → ${diff.enabled ? '开启' : '关闭'}`
        if (r.action === 'evidence.deactivate') summary = `证据停用`
      } catch {
        // 忽略解析失败
      }
      const severity = r.action === 'content.offline' ? '中' : r.action === 'model.rollback' ? '高' : '低';
      return {
        id: `INC-${String(rows.length - i).padStart(3, '0')}`,
        severity,
        date: r.created_at.slice(0, 10),
        summary,
        audit_id: r.id,
      };
    });
  }
}
