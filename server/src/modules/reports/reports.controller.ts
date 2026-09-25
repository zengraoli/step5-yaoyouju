import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CreateReportDto {
  @ApiProperty({ description: '所属病程 ID' })
  @IsString()
  episode_id!: string;

  @ApiProperty({ description: '关联病程事件 ID（缺省自动创建报告事件）', required: false })
  @IsOptional()
  @IsString()
  care_event_id?: string;

  @ApiProperty({ description: '报告日期 YYYY-MM-DD', required: false, nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  report_date?: string | null;

  @ApiProperty({ description: '报告原文（主路径：粘贴文字）' })
  @IsString()
  raw_text!: string;

  @ApiProperty({ description: '来源类型', enum: ['自述', '报告原文', '医生记录'], required: false })
  @IsOptional()
  @IsIn(['自述', '报告原文', '医生记录'])
  source_type?: string;

  @ApiProperty({ description: '核实状态', enum: ['已确认', '尚未确认', '有冲突'], required: false })
  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  verify_status?: string;
}

@ApiTags('报告解析')
@RequireConsent('健康信息处理')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** 录入报告（粘贴文字为主） */
  @ApiOperation({ summary: '录入报告（粘贴文字为主，自动抽取术语与位置）' })
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateReportDto) {
    return this.reports.create(user.id, dto);
  }

  /** 拍照提取（模拟 OCR） */
  @ApiOperation({ summary: '拍照提取（模拟 OCR，返回示例文本）' })
  @Post('ocr')
  ocr(@CurrentUser() user: { id: string }) {
    return this.reports.ocr(user.id);
  }

  @ApiOperation({ summary: '报告详情（含术语与原文位置）' })
  @Get(':id')
  detail(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.reports.get(user.id, id);
  }
}

@ApiTags('报告解析')
@RequireConsent('健康信息处理')
@Controller('episodes')
export class EpisodeReportsController {
  constructor(private readonly reports: ReportsService) {}

  @ApiOperation({ summary: '病程下的报告列表' })
  @Get(':id/reports')
  list(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.reports.listByEpisode(user.id, id);
  }

  /** 结构化核对：来源 / 时间 / 核实状态 / 术语 */
  @ApiOperation({ summary: '结构化核对：来源 / 时间 / 核实状态 / 术语' })
  @Get(':id/structured')
  structured(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.reports.structured(user.id, id);
  }
}
