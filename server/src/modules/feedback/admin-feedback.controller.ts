import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeedbackService, HANDLING_ACTIONS } from './feedback.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../admin/permission.decorator';

class FeedbackQueueQueryDto {
  /** 类型筛选：feedback=帮助类型反馈；error_report=错误举报 */
  @IsOptional()
  @IsIn(['feedback', 'error_report'])
  type?: string;

  /** 状态筛选：待处理 / 处理中 / 已处理 / 无需处理 / 已关闭 / 已收到 */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}

class AuthorizeViewDto {
  /** 授权范围（缺省：本条举报的用户原始内容） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scope?: string;
}

class HandleFeedbackDto {
  /** 处置动作：转内容修正 / 转模型复盘 / 已回复用户 / 无需处理 / 关闭 */
  @IsIn([...HANDLING_ACTIONS])
  action!: string;

  /** 处理记录（必填） */
  @IsString()
  @MaxLength(2000)
  comment!: string;
}

/**
 * 后台 · 举报与反馈队列（B06，T35 复用）。
 *
 * 注意：后台登录鉴权（账号 + TOTP + 角色权限矩阵，如合规角色的「单条授权」权限）
 * 在 T14（后台账号与审计）与 T35（B06 页面）实现，本任务先用全局登录守卫占位，
 * 届时在此控制器上追加后台守卫与角色校验即可，服务方法已在 FeedbackService 中备好。
 *
 * 产品红线：
 * - 反馈与举报不自动进入训练或内容库（处置动作只做线下转办，不自动改写内容库 / 模型）；
 * - 查看用户原始内容需单条授权（authorize-view），未授权时详情返回「未授权，不可查看」，
 *   授权人、时间、范围写入审计日志（只追加）。
 *
 * T14：后台守卫（/admin）+ 角色权限：队列 / 详情 feedback.view，单条授权 consent.view，处置 feedback.handle。
 */
@ApiTags('后台·举报处置')
@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** 队列：按严重度分级排序（high > medium > low），支持按类型 / 状态筛选，附带四类版本与受影响范围 */
  @ApiOperation({ summary: '举报与反馈队列（按严重度分级排序，可按类型 / 状态筛选）' })
  @Get()
  @RequirePermission('feedback.view')
  queue(@Query() query: FeedbackQueueQueryDto) {
    return this.feedback.queue({ type: query.type, status: query.status });
  }

  /** 详情：四类版本、受影响范围、处理记录；用户原始内容未授权时不可见 */
  @ApiOperation({ summary: '举报详情：四类版本、受影响范围、处理记录（用户原始内容未授权不可见）' })
  @Get(':id')
  @RequirePermission('feedback.view')
  detail(@Param('id') id: string) {
    return this.feedback.detail(id);
  }

  /** 单条授权查看用户原始内容（记录授权人、时间、范围到审计日志） */
  @ApiOperation({ summary: '单条授权查看用户原始内容（授权人 / 时间 / 范围写审计）' })
  @Post(':id/authorize-view')
  @RequirePermission('consent.view')
  authorizeView(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: AuthorizeViewDto,
  ) {
    return this.feedback.authorizeView(id, user.id, { scope: dto.scope });
  }

  /** 处置动作与处理记录（写 feedback_handling + 审计日志） */
  @ApiOperation({ summary: '处置举报（动作 + 处理记录，写审计；不自动进入训练或内容库）' })
  @Post(':id/handle')
  @RequirePermission('feedback.handle')
  handle(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: HandleFeedbackDto) {
    return this.feedback.handle(id, user.id, {
      action: dto.action as (typeof HANDLING_ACTIONS)[number],
      comment: dto.comment,
    });
  }
}
