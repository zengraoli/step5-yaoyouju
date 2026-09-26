import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from '../admin/admin-auth.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { FeedbackService, HANDLING_ACTIONS } from './feedback.service';

class AuthorizeViewDto {
  @ApiProperty({ required: false, description: '授权范围（默认：本条举报的用户原始内容）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  scope?: string;
}

class HandleDto {
  @ApiProperty({ description: '处置动作', enum: [...HANDLING_ACTIONS] })
  @IsIn([...HANDLING_ACTIONS])
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
  constructor(private readonly feedback: FeedbackService) {}

  @ApiOperation({ summary: '举报与反馈队列（按严重度分级；自动附带四类版本与受影响范围）' })
  @Get()
  queue(
    @CurrentUser() admin: AdminContext,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.feedback.queue({ type, status });
  }

  @ApiOperation({ summary: '反馈 / 举报详情（未授权时用户原始内容不可见）' })
  @Get(':id')
  detail(@CurrentUser() admin: AdminContext, @Param('id') id: string) {
    return this.feedback.detail(id);
  }

  @ApiOperation({ summary: '单条授权查看用户原始内容（授权人 / 时间 / 范围写入审计）' })
  @RequirePermission('feedback.handle')
  @Post(':id/authorize-view')
  authorizeView(
    @CurrentUser() admin: AdminContext,
    @Param('id') id: string,
    @Body() dto: AuthorizeViewDto,
  ) {
    return this.feedback.authorizeView(id, admin.id, dto);
  }

  @ApiOperation({ summary: '处置动作与处理记录（写审计；不自动改写内容库或模型）' })
  @RequirePermission('feedback.handle')
  @Post(':id/handle')
  handle(@CurrentUser() admin: AdminContext, @Param('id') id: string, @Body() dto: HandleDto) {
    return this.feedback.handle(id, admin.id, {
      action: dto.action as (typeof HANDLING_ACTIONS)[number],
      comment: dto.comment,
    });
  }
}
