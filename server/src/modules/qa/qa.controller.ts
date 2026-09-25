import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { QaService } from './qa.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CreateQaSessionDto {
  /** 关联病程（可选）：后续回答基于该病程的一页分析与事件原文 */
  @ApiProperty({ description: '关联病程 ID（可选，回答基于该病程的一页分析与事件原文）', required: false })
  @IsOptional()
  @IsString()
  episode_id?: string;
}

class AskDto {
  /** 提问内容 */
  @ApiProperty({ description: '提问内容' })
  @IsString()
  content!: string;
}

/**
 * 问与解释（/qa/sessions，App A09 / Web W04）。
 * 需登录 + 需同意「健康信息处理」（全局守卫）。
 */
@ApiTags('问与解释')
@RequireConsent('健康信息处理')
@Controller('qa/sessions')
export class QaController {
  constructor(private readonly qa: QaService) {}

  /** 创建会话（可关联 episode_id） */
  @ApiOperation({ summary: '创建问与解释会话（可关联病程）' })
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateQaSessionDto) {
    return this.qa.create(user.id, dto);
  }

  /** 当前用户的会话历史列表（含最近一条消息摘要、时间） */
  @ApiOperation({ summary: '我的会话历史列表' })
  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.qa.list(user.id);
  }

  /** 会话详情与全部消息（含 citations、是否拒答、是否转为复诊问题） */
  @ApiOperation({ summary: '会话详情与全部消息（含引用、是否拒答、是否转为复诊问题）' })
  @Get(':id')
  detail(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.qa.get(user.id, id);
  }

  /**
   * 提问并回答：
   * - 越界（诊断 / 手术 / 用药）→ refused=true + followup_question（add_to_followup 一键加入复诊问题）
   * - 命中红旗 → 40910 / 40911 + 就医提示（本轮不再生成解释）
   * - 连续求保证 ≥3 次 → close_round=true 稳定解释
   * - 范围内 → 基于当前上下文本地回答，关键陈述带 citations
   */
  @ApiOperation({
    summary: '提问并回答（越界拒答并转复诊问题；命中红旗返回 40910/40911；关键陈述带引用）',
  })
  @Post(':id/messages')
  ask(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: AskDto) {
    return this.qa.ask(user.id, id, dto.content);
  }

  /** 结束本轮（用户主动结束）：返回本轮小结 */
  @ApiOperation({ summary: '结束本轮问与解释（返回本轮小结）' })
  @Post(':id/close')
  close(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.qa.close(user.id, id);
  }
}
