import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { AdminContext } from './admin-auth.service';
import { AuditService } from '../../common/audit.service';
import { AdminAuditService, AuditLogPage, AuditExportRequest } from './admin-audit.service';
import { RequirePermission } from './permission.decorator';

class AuditQueryDto {
  /** 操作人（后台账号名，精确匹配） */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  actor?: string;

  /** 动作（如 admin.login / feedback.authorize_view；可逗号分隔多个） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  /** 对象类型（如 content_item / feedback / admin_user；可逗号分隔多个） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  target_type?: string;

  /** 角色（如 运营编辑 / 超级管理） */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;

  /** 时间范围（UTC ISO8601，闭区间） */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}

class ExportRequestDto {
  /** 导出原因（必填，写审计） */
  @IsString()
  @MaxLength(200)
  reason!: string;
}

class ExportApproveDto {
  @IsString()
  @MaxLength(50)
  request_id!: string;
}

/**
 * 审计日志（T14，B11）：筛选 + 分页、哈希链校验、导出需审批。
 * 查看与校验要求 audit.view（合规 / 超级管理）；导出申请要求 audit.export_request（合规），
 * 导出审批要求 audit.export_approve（仅超级管理员）。
 */
@ApiTags('后台·审计')
@Controller('admin/audit')
@RequirePermission('audit.view')
export class AdminAuditController {
  constructor(
    private readonly adminAudit: AdminAuditService,
    private readonly audit: AuditService,
  ) {}

  /** 列表：时间 / 操作人 / 角色 / 动作 / 对象 / 请求 ID / 哈希 */
  @ApiOperation({ summary: '审计日志列表（筛选 + 分页）' })
  @Get()
  list(@CurrentAdmin() admin: AdminContext, @Query() query: AuditQueryDto): AuditLogPage {
    // 查看审计日志本身也要留痕（验收反馈第 32 条）
    this.audit.append(admin.id, 'audit.view', 'audit_log:list', {
      actor: query.actor ?? null,
      action: query.action ?? null,
    });
    return this.adminAudit.list({
      actor: query.actor,
      action: query.action,
      target_type: query.target_type,
      role: query.role,
      from: query.from,
      to: query.to,
      page: query.page,
      page_size: query.page_size,
    });
  }

  /** 哈希链校验：篡改任何一条都会被发现 */
  @ApiOperation({ summary: '审计哈希链校验（篡改任何一条都会被发现）' })
  @Get('verify')
  verify(): { ok: boolean; broken_at: string | null } {
    return this.adminAudit.verify();
  }

  /** 提交导出申请（状态待审批；合规支持可申请） */
  @ApiOperation({ summary: '提交审计导出申请（状态待审批）' })
  @Post('export-request')
  @RequirePermission('audit.export_request')
  requestExport(@CurrentAdmin() admin: AdminContext, @Body() dto: ExportRequestDto): AuditExportRequest {
    return this.adminAudit.requestExport(admin.id, dto.reason);
  }

  /** 审批导出申请（仅超级管理员；不能审批本人提交的申请） */
  @ApiOperation({ summary: '审批审计导出申请（仅超级管理员；不能审批本人提交的申请）' })
  @Post('export-approve')
  @RequirePermission('audit.export_approve')
  approveExport(@CurrentAdmin() admin: AdminContext, @Body() dto: ExportApproveDto): AuditExportRequest {
    return this.adminAudit.approveExport(admin.id, dto.request_id);
  }

  /** 导出申请列表（申请与审批记录，含申请人 / 审批人） */
  @ApiOperation({ summary: '审计导出申请与审批列表' })
  @Get('export-requests')
  listExportRequests(): { items: AuditExportRequest[] } {
    return { items: this.adminAudit.listExportRequests() };
  }

  /**
   * 下载导出文件（审批通过后才能下载；未审批返回 40900）。
   * 演示实现：返回 JSON 文本（前端触发浏览器下载）。
   */
  @ApiOperation({ summary: '下载审计导出文件（需已审批）' })
  @Get('export')
  @RequirePermission('audit.view')
  exportFile(@CurrentAdmin() admin: AdminContext, @Res() res: Response, @Query('request_id') requestId?: string) {
    const { filename, body } = this.adminAudit.buildExport(admin.id, requestId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }
}
