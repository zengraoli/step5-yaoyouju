import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiException, ErrorCode } from '../../common/api-error';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from '../admin/admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { ContentsService, ContentDetail } from './contents.service';
import { ConfirmationService } from '../admin/confirmation.service';

/** 编辑草稿（部分字段即可，第七轮验收反馈第 7 条：运营只改标题 / 脚本时不必重复传 type） */
class UpdateDraftDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

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

  @ApiProperty({ description: '双人确认单 ID（另一方确认后带上即可生效）', required: false })
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

class PublishDto {
  @ApiProperty({ description: '双人确认单 ID（发起发布后由另一名账号确认后带上）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  confirmation_id?: string;
}

class BatchOfflineDto {
  @ApiProperty({ description: '内容 ID 列表' })
  @IsArray()
  ids!: string[];

  @ApiProperty({ description: '每条内容对应的双人确认单 ID（另一方确认后带上即可生效）', required: false })
  @IsOptional()
  confirmation_ids?: Record<string, string>;

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
  constructor(
    private readonly contents: ContentsService,
    private readonly confirmations: ConfirmationService,
  ) {}

  @ApiOperation({ summary: '内容列表（筛选 + 状态统计 + 分页）' })
  @RequirePermission('content.view')
  @Get()
  list(
    @CurrentAdmin() admin: AdminContext,
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
  @RequirePermission('content.view')
  @Get(':id')
  detail(@CurrentAdmin() admin: AdminContext, @Param('id') id: string): ContentDetail {
    return this.contents.adminDetail(id);
  }

  @ApiOperation({ summary: '创建草稿（运营编辑）' })
  @RequirePermission('content.draft')
  @Post()
  create(@CurrentAdmin() admin: AdminContext, @Body() dto: DraftDto): ContentDetail {
    return this.contents.createDraft(admin.id, dto);
  }

  @ApiOperation({ summary: '编辑草稿（仅草稿可编辑）' })
  @RequirePermission('content.draft')
  @Patch(':id')
  update(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: UpdateDraftDto,
  ): ContentDetail {
    return this.contents.updateDraft(admin.id, id, dto);
  }

  @ApiOperation({ summary: '提交审核（草稿 → 待医学审核）' })
  @RequirePermission('content.draft')
  @Post(':id/submit')
  submit(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: SubmitDto,
  ): ContentDetail {
    return this.contents.submitForReview(admin.id, id, dto);
  }

  @ApiOperation({ summary: '审核通过（待医学审核 → 已审定，记录审核人与范围）' })
  @RequirePermission('content.review')
  @Post(':id/approve')
  approve(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ApproveDto,
  ): ContentDetail {
    return this.contents.approve(admin.id, id, dto);
  }

  @ApiOperation({ summary: '退回修改（待医学审核 → 草稿，记录意见）' })
  @RequirePermission('content.review')
  @Post(':id/reject')
  reject(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: RejectDto,
  ): ContentDetail {
    return this.contents.reject(admin.id, id, dto);
  }

  /**
   * 发布（已审定 → 已发布；需双人确认）。
   * - 有 content.publish（临床审核 / 超级管理）的账号：沿用「审核人与发布人不能是同一人」的双人规则；
   * - 只有 content.submit（运营编辑）的账号：点「发起发布」即生成确认单，
   *   由另一名临床审核 / 超级管理在「待我确认」里确认后执行（第七轮验收反馈第 7 条）。
   */
  @ApiOperation({ summary: '发布（已审定 → 已发布；需双人确认）' })
  @Post(':id/publish')
  publish(@CurrentAdmin() admin: AdminContext, @Param('id') id: string, @Body() dto?: PublishDto) {
    const canPublish = admin.permissions.includes('*') || admin.permissions.includes('content.publish');
    const canInitiate = admin.permissions.includes('*') || admin.permissions.includes('content.submit');
    if (!canPublish && !canInitiate) {
      throw new ApiException(ErrorCode.FORBIDDEN, '没有权限执行该操作');
    }
    const detail = this.contents.adminDetail(id);
    if (!canPublish) {
      // 运营编辑：只能发起，等另一名具备发布权限的账号确认后生效
      const gate = this.confirmations.prepare(
        'content.publish',
        id,
        detail.title,
        dto?.confirmation_id ? '另一人已确认的发布申请' : `发布《${detail.title}》`,
        admin,
        dto?.confirmation_id,
      );
      if (!gate.proceed) {
        throw new ApiException(
          ErrorCode.CONFLICT,
          `已提交「发布《${detail.title}》」双人确认申请（需${gate.confirmation?.requirement ?? '临床审核 / 超级管理员'}确认后生效）`,
          {
            confirmation_id: gate.confirmation?.id ?? null,
            requirement: gate.confirmation?.requirement ?? null,
          },
        );
      }
      const result = this.contents.publish(admin.id, id);
      this.confirmations.markApplied(gate.confirmation!.id);
      return result;
    }
    return this.contents.publish(admin.id, id);
  }

  @ApiOperation({ summary: '引用定位预览（下线前查看受影响的页面）' })
  @RequirePermission('content.view')
  @Get(':id/impact')
  impact(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    return this.contents.impactPreview(id);
  }

  @ApiOperation({ summary: '一键下线（发布 → 已下线，返回引用定位）' })
  @RequirePermission('content.offline')
  @Post(':id/take-offline')
  takeOffline(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.contents.takeOffline(admin.id, admin, id, dto);
  }

  @ApiOperation({ summary: '撤回（发布 → 已撤回）' })
  @RequirePermission('content.offline')
  @Post(':id/withdraw')
  withdraw(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ): ContentDetail {
    return this.contents.withdraw(admin.id, admin, id, dto);
  }

  @ApiOperation({ summary: '标记更正（发布 → 更正中）' })
  @RequirePermission('content.draft')
  @Post(':id/mark-correcting')
  markCorrecting(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ): ContentDetail {
    return this.contents.markCorrecting(admin.id, id, dto);
  }

  @ApiOperation({ summary: '提交新版本（更正中 → 待医学审核）' })
  @RequirePermission('content.draft')
  @Post(':id/resubmit')
  resubmit(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: SubmitDto,
  ): ContentDetail {
    return this.contents.resubmit(admin.id, id, dto);
  }

  @ApiOperation({ summary: '批量下线（需双人确认）' })
  @RequirePermission('content.offline')
  @Post('batch-take-offline')
  batchTakeOffline(@CurrentAdmin() admin: AdminContext, @Body() dto: BatchOfflineDto) {
    const ids = (dto.ids ?? []).filter((id) => typeof id === 'string' && id.trim());
    if (ids.length === 0) {
      throw new ApiException(ErrorCode.BAD_REQUEST, '请选择要下线的内容');
    }
    return this.contents.batchTakeOffline(admin.id, admin, ids, dto.reason ?? '', dto.confirmation_ids);
  }
}

