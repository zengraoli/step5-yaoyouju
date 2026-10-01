import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from '../admin/admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuditService } from '../../common/audit.service';
import { FeedbackService, HANDLING_ACTIONS } from './feedback.service';

class AuthorizeViewDto {
  @ApiProperty({ required: false, description: '授权范围（默认：本条举报的用户原始内容）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  scope?: string;

  @ApiProperty({ description: '双人确认单 ID（超级管理员审批后带上才生效）', required: false })
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

class TriageDto {
  @ApiProperty({ description: '初筛结论', enum: ['待临床复核', '无需处理', '关闭'] })
  @IsIn(['待临床复核', '无需处理', '关闭'], { message: '初筛结论必须是：待临床复核 / 无需处理 / 关闭' })
  action!: string;

  @ApiProperty({ description: '初筛记录（必填）' })
  @IsString()
  @MaxLength(1000)
  comment!: string;
}

class HandleDto {
  @ApiProperty({ description: '处置动作', enum: [...HANDLING_ACTIONS] })
  @IsIn([...HANDLING_ACTIONS], { message: `处置动作必须是：${HANDLING_ACTIONS.join(' / ')}` })
  action!: string;

  @ApiProperty({ description: '处理记录（必填）' })
  @IsString()
  @MaxLength(1000)
  comment!: string;
}

/** 后台举报与反馈队列（B06）：按严重度分级、四类版本、单条授权、处置记录 */
@ApiTags('admin-feedback')
@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService, private readonly audit: AuditService) {}

  /**
   * 举报初筛（运营编辑 / 超级管理可做）：只做状态流转，不看原文、不做临床复核。
   * 初筛动作：标记「待临床复核」/「无需处理」/「关闭」。
   */
  @ApiOperation({ summary: '举报初筛（运营编辑可做：流转状态，不看原文）' })
  @RequirePermission('feedback.triage')
  @Post(':id/triage')
  triage(
    @CurrentAdmin() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: TriageDto,
  ) {
    return this.feedback.triage(id, admin.id, dto);
  }

  @ApiOperation({ summary: '举报与反馈队列（按严重度分级；自动附带四类版本与受影响范围）' })
  @RequirePermission('feedback.view')
  @Get()
  queue(
    @CurrentAdmin() admin: AdminContext,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    // 读取举报队列会暴露用户描述与受影响用户，属于敏感读取，必须留痕（验收反馈第 46 条）
    this.audit.append(admin.id, 'feedback.queue_view', 'feedback:queue', {
      type: type ?? null,
      status: status ?? null,
    });
    return {
      items: this.feedback.queue({ type, status }),
      stats: this.feedback.stats(),
    };
  }

  @ApiOperation({ summary: '反馈 / 举报详情（未授权时用户原始内容不可见；读取写审计）' })
  @RequirePermission('feedback.view')
  @Get(':id')
  detail(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    // 只有临床复核角色（feedback.handle）才能看到原文快照；运营编辑只做初筛（验收反馈第 10 条）
    const canViewRaw =
      admin.permissions.includes('*') || admin.permissions.includes('feedback.handle');
    return this.feedback.detail(id, admin.id, canViewRaw);
  }

  @ApiOperation({ summary: '单条授权查看用户原始内容（授权人 / 时间 / 范围写入审计；需超级管理员审批）' })
  @RequirePermission('feedback.handle')
  @Post(':id/authorize-view')
  authorizeView(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: AuthorizeViewDto,
  ) {
    return this.feedback.authorizeView(id, admin.id, dto);
  }

  @ApiOperation({ summary: '撤回单条授权（立即生效，写审计）' })
  @RequirePermission('feedback.handle')
  @Post(':id/revoke-view')
  revokeView(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    return this.feedback.revokeAuthorization(id, admin.id);
  }

  @ApiOperation({ summary: '处置动作与处理记录（写审计；不自动改写内容库或模型）' })
  @RequirePermission('feedback.handle')
  @Post(':id/handle')
  handle(@CurrentAdmin() admin: AdminContext, @Param('id') id: string, @Body() dto: HandleDto) {
    return this.feedback.handle(id, admin.id, {
      action: dto.action as (typeof HANDLING_ACTIONS)[number],
      comment: dto.comment,
    });
  }
}
