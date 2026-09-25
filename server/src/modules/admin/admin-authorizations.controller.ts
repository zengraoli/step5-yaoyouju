import { Controller, Get, Query } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminAuditService, AuditLogPage } from './admin-audit.service';
import { RequirePermission } from './permission.decorator';

class AuthorizationQueryDto {
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

/**
 * 单条授权记录（T14，B10）。
 * 数据来源为审计日志中 T12 的 feedback.authorize_view 记录（授权人 / 时间 / 范围）。
 */
@Controller('admin/authorizations')
@RequirePermission('consent.view')
export class AdminAuthorizationsController {
  constructor(private readonly adminAudit: AdminAuditService) {}

  @Get()
  list(@Query() query: AuthorizationQueryDto): AuditLogPage {
    return this.adminAudit.listAuthorizations({ page: query.page, page_size: query.page_size });
  }
}
