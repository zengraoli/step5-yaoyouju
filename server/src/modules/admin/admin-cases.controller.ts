import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from './admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { DbService } from '../../db/db.service';
import { AuditService } from '../../common/audit.service';
import { SwitchesService } from '../switches/switches.service';
import { ApiException, ErrorCode } from '../../common/api-error';

class SuggestionDto {
  @ApiProperty({ description: '编辑建议（发送给用户，需用户确认）' })
  @IsString()
  @MaxLength(1000)
  suggestion!: string;
}

class ReasonDto {
  @ApiProperty({ description: '退回原因', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

void randomUUID;

/** 案例投稿审核（B12，二期预留；受「案例卡片」功能开关控制） */
@ApiTags('admin-cases')
@Controller('admin/cases')
export class AdminCasesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly switches: SwitchesService,
  ) {}

  @ApiOperation({ summary: '投稿队列（授权范围 / 第三方信息 / 状态）' })
  @Get()
  list(@Query('status') status?: string) {
    const where = status && status !== '全部' ? 'WHERE status = ?' : '';
    const params = status && status !== '全部' ? [status] : [];
    const rows = this.db.app
      .prepare(`SELECT * FROM case_submission ${where} ORDER BY created_at DESC`)
      .all(...params) as {
      id: string;
      user_id: string;
      edited_content: string | null;
      consent_scope: string | null;
      status: string;
      created_at: string;
    }[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: `#CS-${r.id.slice(0, 4).toUpperCase()}`,
        user_masked: `U-${r.user_id.slice(0, 4).toUpperCase()}…`,
        summary: (r.edited_content ?? '').slice(0, 40),
        consent_scope: r.consent_scope ?? '—',
        status: r.status,
        created_at: r.created_at,
      })),
      switch_enabled: this.switches.isEnabled('案例卡片'),
    };
  }

  @ApiOperation({ summary: '投稿详情（用户提交 / 编辑建议 / 授权范围 / 第三方信息去除对照）' })
  @Get(':id')
  detail(@Param('id') id: string) {
    const row = this.db.app.prepare('SELECT * FROM case_submission WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new ApiException(ErrorCode.NOT_FOUND, '投稿不存在');
    }
    return {
      id: row.id,
      code: `#CS-${String(row.id).slice(0, 4).toUpperCase()}`,
      user_masked: `U-${String(row.user_id).slice(0, 4).toUpperCase()}…`,
      user_submission: String(row.edited_content ?? ''),
      status: row.status,
      consent_scope: row.consent_scope,
      created_at: row.created_at,
      switch_enabled: this.switches.isEnabled('案例卡片'),
      risk_checklist: [
        { key: 'time_place', label: '罕见经历 + 时间 + 医院 + 职业的组合是否可能指向具体个人', status: 'pending' },
        { key: 'third_party', label: '是否包含第三方（医生、家人、病友）可识别信息', status: 'detected', count: 2 },
        { key: 'names', label: '是否包含具体机构名称、地址、联系方式', status: 'cleared' },
        { key: 'media', label: '是否包含影像 / 报告截图', status: 'none' },
        { key: 'ending', label: '结局是否为“未知 / 失访”并如实标注', status: 'labeled' },
        { key: 'recall', label: '撤回链路：公开卡片 / 索引 / 向量 / 缓存 / 派生摘要', status: 'configured' },
      ],
    };
  }

  @ApiOperation({ summary: '发送编辑建议给用户（需用户确认）' })
  @RequirePermission('case.manage')
  @Post(':id/send-suggestion')
  sendSuggestion(@CurrentAdmin() admin: AdminContext, @Param('id') id: string, @Body() dto: SuggestionDto) {
    this.db.app
      .prepare('UPDATE case_submission SET status = ? WHERE id = ?')
      .run('待用户确认', id);
    this.audit.append(admin.id, 'case.send_suggestion', `case_submission:${id}`, {
      suggestion: dto.suggestion,
    });
    return { id, status: '待用户确认' };
  }

  @ApiOperation({ summary: '退回给用户编辑' })
  @RequirePermission('case.manage')
  @Post(':id/return')
  returnToUser(@CurrentAdmin() admin: AdminContext, @Param('id') id: string, @Body() dto: ReasonDto) {
    this.db.app.prepare('UPDATE case_submission SET status = ? WHERE id = ?').run('待修改', id);
    this.audit.append(admin.id, 'case.return', `case_submission:${id}`, { reason: dto.reason });
    return { id, status: '待修改' };
  }

  @ApiOperation({ summary: '发布投稿（受「案例卡片」开关控制；关闭时不可用）' })
  @RequirePermission('case.manage')
  @Post(':id/publish')
  publish(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    if (!this.switches.isEnabled('案例卡片')) {
      throw new ApiException(
        ErrorCode.CONFLICT,
        '案例卡片功能未开启（二期预留），当前不可发布',
      );
    }
    this.db.app.prepare('UPDATE case_submission SET status = ? WHERE id = ?').run('已发布', id);
    this.audit.append(admin.id, 'case.publish', `case_submission:${id}`, {});
    return { id, status: '已发布' };
  }
}
