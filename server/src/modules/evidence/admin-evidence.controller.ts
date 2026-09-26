import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from '../admin/admin-auth.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { EvidenceService } from './evidence.service';

class AdminEvidenceDocBody {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: '来源类型：指南 / 研究 / 审核科普 / 其他' })
  @IsIn(['指南', '研究', '审核科普', '其他'])
  source_type!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  source_url?: string | null;

  @ApiProperty({ required: false, description: '许可：可引用 / 待确认 / 仅内部' })
  @IsOptional()
  @IsString()
  license?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  verified_at?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  raw_text?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class AdminEvidenceActiveBody {
  @ApiProperty({ description: 'true 启用 / false 停用' })
  @IsBoolean()
  active!: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * 后台医学证据库（B05：来源类型 / 许可 / 核实日期；入库管线状态；停用影响预览）。
 * 与用户侧 /evidence 读接口共用同一服务；写操作以后台身份记审计。
 */
@ApiTags('admin-evidence')
@Controller('admin/evidence')
export class AdminEvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @ApiOperation({ summary: '证据文档列表（来源类型 / 启用状态筛选，带片段数与被引用数）' })
  @Get()
  list(@Query('source_type') sourceType?: string, @Query('active') active?: string) {
    return this.evidence.list({
      source_type: sourceType?.trim() || undefined,
      active: active === undefined ? undefined : active === 'true' || active === '1',
    });
  }

  @ApiOperation({ summary: '证据文档详情（含原文）' })
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.evidence.detail(id);
  }

  @ApiOperation({ summary: '入库管线状态（待切分 / 已切分 / 失败、片段数、最近入库时间）' })
  @Get(':id/pipeline')
  pipeline(@Param('id') id: string) {
    return this.evidence.pipeline(id);
  }

  @ApiOperation({ summary: '停用影响预览：引用该证据的内容与分析列表' })
  @Get(':id/impact')
  impact(@Param('id') id: string) {
    return this.evidence.impactPreview(id);
  }

  @ApiOperation({ summary: '新建证据文档' })
  @RequirePermission('evidence.ingest')
  @Post()
  create(@CurrentUser() admin: AdminContext, @Body() body: AdminEvidenceDocBody) {
    return this.evidence.create(admin.id, body);
  }

  @ApiOperation({ summary: '编辑证据文档（改动写审计）' })
  @RequirePermission('evidence.ingest')
  @Patch(':id')
  update(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() body: AdminEvidenceDocBody,
  ) {
    return this.evidence.update(admin.id, id, body);
  }

  @ApiOperation({ summary: '停用 / 启用证据文档（停用时返回影响预览，供确认）' })
  @RequirePermission('evidence.deactivate')
  @Post(':id/active')
  setActive(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() body: AdminEvidenceActiveBody,
  ) {
    return this.evidence.setActive(admin.id, id, body.active, body.reason);
  }

  @ApiOperation({ summary: '切分入库（切分片段并计算本地向量，幂等）' })
  @RequirePermission('evidence.ingest')
  @Post(':id/ingest')
  ingest(@CurrentUser() admin: AdminContext, @Param('id') id: string) {
    return this.evidence.ingest(admin.id, id);
  }
}
