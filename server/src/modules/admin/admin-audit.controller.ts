import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { AdminContext } from './admin-auth.service';
import { AdminAuditService, AuditLogPage, AuditExportRequest } from './admin-audit.service';
import { RequirePermission } from './permission.decorator';

class AuditQueryDto {
  /** 操作人（后台账号名，精确匹配） */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  actor?: string;

  /** 动作（如 admin.login / feedback.authorize_view） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

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
 * 查看与校验要求 audit.view（合规 / 超级管理）；导出申请与审批要求 audit.export。
 */
@ApiTags('后台·审计')
@Controller('admin/audit')
@RequirePermission('audit.view')
export class AdminAuditController {
  constructor(private readonly adminAudit: AdminAuditService) {}

  /** 列表：时间 / 操作人 / 角色 / 动作 / 对象 / 请求 ID / 哈希 */
  @ApiOperation({ summary: '审计日志列表（筛选 + 分页）' })
  @Get()
  list(@Query() query: AuditQueryDto): AuditLogPage {
    return this.adminAudit.list({
      actor: query.actor,
      action: query.action,
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

  /** 提交导出申请（状态待审批） */
  @ApiOperation({ summary: '提交审计导出申请（状态待审批）' })
  @Post('export-request')
  @RequirePermission('audit.export')
  requestExport(@CurrentAdmin() admin: AdminContext, @Body() dto: ExportRequestDto): AuditExportRequest {
    return this.adminAudit.requestExport(admin.id, dto.reason);
  }

  /** 审批导出申请（合规或超级管理；不能审批本人提交的申请） */
  @ApiOperation({ summary: '审批审计导出申请（不能审批本人提交的申请）' })
  @Post('export-approve')
  @RequirePermission('audit.export')
  approveExport(@CurrentAdmin() admin: AdminContext, @Body() dto: ExportApproveDto): AuditExportRequest {
    return this.adminAudit.approveExport(admin.id, dto.request_id);
  }
}
