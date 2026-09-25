import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeedbackService, HANDLING_ACTIONS, HELP_TYPES, SEVERITIES } from './feedback.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CreateFeedbackDto {
  /** 关联的一页分析（必须是本人分析） */
  @ApiProperty({ description: '关联的一页分析 ID（必须是本人分析）' })
  @IsString()
  analysis_id!: string;

  /** 帮助类型：看懂了 / 知道下一步 / 都不好 */
  @ApiProperty({ description: '帮助类型', enum: [...HELP_TYPES] })
  @IsIn([...HELP_TYPES])
  help_type!: string;

  /** 未解决的问题（可选） */
  @ApiProperty({ description: '未解决的问题（可选）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  unsolved_question?: string;
}

class CreateErrorReportDto {
  /** 关联的分析（可选，与 content_item_id 至少填一个） */
  @ApiProperty({ description: '关联的分析 ID（与 content_item_id 至少填一个）', required: false })
  @IsOptional()
  @IsString()
  analysis_id?: string;

  /** 关联的内容（可选，与 analysis_id 至少填一个） */
  @ApiProperty({ description: '关联的内容 ID（与 analysis_id 至少填一个）', required: false })
  @IsOptional()
  @IsString()
  content_item_id?: string;

  /** 举报分类，如：解释与报告不符 / 来源缺失 / 内容出错 / 其他 */
  @ApiProperty({ description: '举报分类', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  category!: string;

  /** 举报说明 */
  @ApiProperty({ description: '举报说明', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  description!: string;

  /** 严重度：high=可能造成健康风险/安全相关；medium=解释与报告不符/来源问题；low=其他（缺省按分类推断） */
  @ApiProperty({ description: '严重度', enum: [...SEVERITIES], required: false })
  @IsOptional()
  @IsIn([...SEVERITIES])
  severity?: string;
}

/**
 * 用户端反馈（/feedback，App A16 / Web W08）。
 * 需登录 + 同意「健康信息处理」（全局守卫）。
 *
 * 产品红线：反馈与举报**不自动进入训练或内容库**——本控制器只写入 feedback 表，
 * 没有任何自动入库逻辑；后台查看用户原始内容需单条授权（见 AdminFeedbackController）。
 */
@ApiTags('反馈与举报')
@RequireConsent('健康信息处理')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  /** 帮助类型反馈：看懂了 / 知道下一步 / 都不好 + 未解决的问题 */
  @ApiOperation({ summary: '提交帮助类型反馈（不自动进入训练或内容库）' })
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateFeedbackDto) {
    return this.feedback.createHelpFeedback(user.id, {
      analysis_id: dto.analysis_id,
      help_type: dto.help_type as (typeof HELP_TYPES)[number],
      unsolved_question: dto.unsolved_question,
    });
  }

  /**
   * 错误举报：自动附带四类版本（分析 / 模型 / 内容 / 规则集）。
   * 提交后进入后台举报队列（B06），不自动进入训练或内容库。
   */
  @ApiOperation({ summary: '提交错误举报（自动附带四类版本，进入后台队列）' })
  @Post('error-report')
  report(@CurrentUser() user: { id: string }, @Body() dto: CreateErrorReportDto) {
    return this.feedback.createErrorReport(user.id, {
      analysis_id: dto.analysis_id,
      content_item_id: dto.content_item_id,
      category: dto.category,
      description: dto.description,
      severity: dto.severity as (typeof SEVERITIES)[number] | undefined,
    });
  }

  /** 我提交的反馈与举报列表（含处理状态） */
  @ApiOperation({ summary: '我提交的反馈与举报列表（含处理状态）' })
  @Get('mine')
  mine(@CurrentUser() user: { id: string }) {
    return this.feedback.listMine(user.id);
  }

  /** 单条反馈 / 举报详情与处理进度（仅本人；他人反馈 404） */
  @ApiOperation({ summary: '单条反馈 / 举报详情与处理进度（仅本人）' })
  @Get(':id')
  detail(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.feedback.detailMine(user.id, id);
  }
}
