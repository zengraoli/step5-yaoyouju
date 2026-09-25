import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CreateReportDto {
  @IsString()
  episode_id!: string;

  @IsOptional()
  @IsString()
  care_event_id?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  report_date?: string | null;

  @IsString()
  raw_text!: string;

  @IsOptional()
  @IsIn(['自述', '报告原文', '医生记录'])
  source_type?: string;

  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  verify_status?: string;
}

@RequireConsent('健康信息处理')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** 录入报告（粘贴文字为主） */
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateReportDto) {
    return this.reports.create(user.id, dto);
  }

  /** 拍照提取（模拟 OCR） */
  @Post('ocr')
  ocr(@CurrentUser() user: { id: string }) {
    return this.reports.ocr(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.reports.get(user.id, id);
  }
}

@RequireConsent('健康信息处理')
@Controller('episodes')
export class EpisodeReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':id/reports')
  list(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.reports.listByEpisode(user.id, id);
  }

  /** 结构化核对：来源 / 时间 / 核实状态 / 术语 */
  @Get(':id/structured')
  structured(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.reports.structured(user.id, id);
  }
}
