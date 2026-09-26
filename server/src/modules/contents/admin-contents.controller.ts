import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiException, ErrorCode } from '../../common/api-error';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from '../admin/admin-auth.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { ContentsService, ContentDetail } from './contents.service';

class DraftDto {
  @ApiProperty()
  @IsString()
  type!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  applicable_scope?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  not_applicable?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  script?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  subtitle_text?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  asset_key?: string | null;
}

class SubmitDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  script?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  subtitle_text?: string | null;
}

class ApproveDto {
  @ApiProperty({ description: '审核范围', required: false })
  @IsOptional()
  @IsString()
  review_scope?: string;

  @ApiProperty({ description: '审核意见', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

class RejectDto {
  @ApiProperty({ description: '退回意见（必填）' })
  @IsString()
  @MaxLength(500)
  comment!: string;
}

class ReasonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class BatchOfflineDto {
  @ApiProperty({ description: '内容 ID 列表' })
  @IsArray()
  ids!: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** 后台内容管理（B03 / B04）：状态机流转 + 双人确认 + 一键下线 */
@ApiTags('admin-contents')
@Controller('admin/contents')
export class AdminContentsController {
  constructor(private readonly contents: ContentsService) {}

  @ApiOperation({ summary: '内容列表（筛选 + 状态统计 + 分页）' })
  @Get()
  list(
    @CurrentUser() admin: AdminContext,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('scope') scope?: string,
    @Query('reviewer') reviewer?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.contents.listForAdmin(admin.id, {
      type,
      status,
      scope,
      reviewer,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 10,
    });
  }

  @ApiOperation({ summary: '内容详情（版本链、审核记录、引用定位）' })
  @Get(':id')
  detail(@CurrentUser() admin: AdminContext, @Param('id') id: string): ContentDetail {
    return this.contents.adminDetail(id);
  }

  @ApiOperation({ summary: '创建草稿（运营编辑）' })
  @RequirePermission('content.draft')
  @Post()
  create(@CurrentUser() admin: AdminContext, @Body() dto: DraftDto): ContentDetail {
    return this.contents.createDraft(admin.id, dto);
  }

  @ApiOperation({ summary: '编辑草稿（仅草稿可编辑）' })
  @RequirePermission('content.draft')
  @Patch(':id')
  update(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: DraftDto,
  ): ContentDetail {
    return this.contents.updateDraft(admin.id, id, dto);
  }

  @ApiOperation({ summary: '提交审核（草稿 → 待医学审核）' })
  @RequirePermission('content.draft')
  @Post(':id/submit')
  submit(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: SubmitDto,
  ): ContentDetail {
    return this.contents.submitForReview(admin.id, id, dto);
  }

  @ApiOperation({ summary: '审核通过（待医学审核 → 已审定，记录审核人与范围）' })
  @RequirePermission('content.review')
  @Post(':id/approve')
  approve(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ApproveDto,
  ): ContentDetail {
    return this.contents.approve(admin.id, id, dto);
  }

  @ApiOperation({ summary: '退回修改（待医学审核 → 草稿，记录意见）' })
  @RequirePermission('content.review')
  @Post(':id/reject')
  reject(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: RejectDto,
  ): ContentDetail {
    return this.contents.reject(admin.id, id, dto);
  }

  @ApiOperation({ summary: '发布（已审定 → 已发布；需双人确认）' })
  @RequirePermission('content.publish')
  @Post(':id/publish')
  publish(@CurrentUser() admin: AdminContext, @Param('id') id: string): ContentDetail {
    return this.contents.publish(admin.id, id);
  }

  @ApiOperation({ summary: '引用定位预览（下线前查看受影响的页面）' })
  @Get(':id/impact')
  impact(@CurrentUser() admin: AdminContext, @Param('id') id: string) {
    return this.contents.impactPreview(id);
  }

  @ApiOperation({ summary: '一键下线（发布 → 已下线，返回引用定位）' })
  @RequirePermission('content.offline')
  @Post(':id/take-offline')
  takeOffline(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.contents.takeOffline(admin.id, id, dto);
  }

  @ApiOperation({ summary: '撤回（发布 → 已撤回）' })
  @RequirePermission('content.offline')
  @Post(':id/withdraw')
  withdraw(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ): ContentDetail {
    return this.contents.withdraw(admin.id, id, dto);
  }

  @ApiOperation({ summary: '标记更正（发布 → 更正中）' })
  @RequirePermission('content.draft')
  @Post(':id/mark-correcting')
  markCorrecting(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ): ContentDetail {
    return this.contents.markCorrecting(admin.id, id, dto);
  }

  @ApiOperation({ summary: '提交新版本（更正中 → 待医学审核）' })
  @RequirePermission('content.draft')
  @Post(':id/resubmit')
  resubmit(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: SubmitDto,
  ): ContentDetail {
    return this.contents.resubmit(admin.id, id, dto);
  }

  @ApiOperation({ summary: '批量下线（需双人确认）' })
  @RequirePermission('content.offline')
  @Post('batch-take-offline')
  batchTakeOffline(@CurrentUser() admin: AdminContext, @Body() dto: BatchOfflineDto) {
    const ids = (dto.ids ?? []).filter((id) => typeof id === 'string' && id.trim());
    if (ids.length === 0) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请选择要下线的内容');
    }
    return this.contents.batchTakeOffline(admin.id, ids, dto.reason ?? '');
  }
}

