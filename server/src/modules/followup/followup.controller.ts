import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { IsArray, IsIn, IsOptional } from 'class-validator';
import { FollowupService } from './followup.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CorrectFollowupDto {
  /** 纠正后的固定六段（key / title / items，items 可编辑文字、增删、调整顺序） */
  @IsOptional()
  @IsArray({ message: '摘要内容格式不正确：sections 应为固定六段的数组' })
  sections?: unknown[];
}

class ExportFollowupDto {
  /** 导出格式：文本（纯文本）/ PDF、图片（浏览器打印生成） */
  @IsIn(['文本', 'PDF', '图片'], { message: '导出格式必须是：文本 / PDF / 图片' })
  format!: string;
}

/**
 * 复诊摘要（/episodes/{id}/followup，App A12 / Web W06）。
 * 需登录 + 需同意「健康信息处理」（全局守卫）；只能操作自己的病程（他人 404）。
 * 固定六段、区分来源、未核实项保留并标记；预览后纠正；导出文本（PDF / 图片由浏览器打印生成）。
 */
@RequireConsent('健康信息处理')
@Controller('episodes')
export class FollowupController {
  constructor(private readonly followup: FollowupService) {}

  /** 生成六段草稿：从该病程的 care_event 自动整理（可反复重新生成） */
  @Post(':id/followup/generate')
  generate(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.followup.generate(user.id, id);
  }

  /** 最新一份摘要（六段 content + 生成时间 + 是否已导出） */
  @Get(':id/followup')
  latest(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.followup.latest(user.id, id);
  }

  /** 预览后纠正：编辑各段文字、增删问题、调整问题顺序；保留来源标记 */
  @Put(':id/followup/:summaryId')
  correct(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('summaryId') summaryId: string,
    @Body() dto: CorrectFollowupDto,
  ) {
    return this.followup.correct(user.id, id, summaryId, dto);
  }

  /** 导出：文本返回纯文本（带头部与水印脚注）；PDF / 图片由浏览器打印生成 */
  @Post(':id/followup/:summaryId/export')
  exportSummary(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('summaryId') summaryId: string,
    @Body() dto: ExportFollowupDto,
  ) {
    return this.followup.exportSummary(user.id, id, summaryId, dto.format);
  }
}
