import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { EpisodesService } from './episodes.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CreateEpisodeDto {
  @ApiProperty({ description: '病程标题', example: '久坐后腰痛' })
  @IsString()
  title!: string;

  @ApiProperty({ description: '起病日期 YYYY-MM-DD，可为空=尚未确认', required: false, nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  onset_date?: string | null;

  @ApiProperty({ description: '起病确定度', enum: ['已确认', '尚未确认', '有冲突'], required: false })
  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  onset_certainty?: string;
}

class UpdateEpisodeDto {
  @ApiProperty({ description: '病程标题', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: '起病日期 YYYY-MM-DD', required: false, nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  onset_date?: string | null;

  @ApiProperty({ description: '起病确定度', enum: ['已确认', '尚未确认', '有冲突'], required: false })
  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  onset_certainty?: string;

  @ApiProperty({ description: '病程状态', enum: ['进行中', '已结束'], required: false })
  @IsOptional()
  @IsIn(['进行中', '已结束'])
  status?: string;
}

class CreateEventDto {
  @ApiProperty({ description: '事件类型', enum: ['报告', '症状', '医嘱', '行动', '结局'] })
  @IsIn(['报告', '症状', '医嘱', '行动', '结局'])
  event_type!: string;

  @ApiProperty({ description: '发生时间（UTC ISO8601）' })
  @IsString()
  occurred_at!: string;

  @ApiProperty({ description: '来源类型', enum: ['自述', '报告原文', '医生记录'] })
  @IsIn(['自述', '报告原文', '医生记录'])
  source_type!: string;

  @ApiProperty({ description: '原文片段', required: false, nullable: true })
  @IsOptional()
  @IsString()
  raw_text?: string | null;

  @ApiProperty({ description: '核实状态', enum: ['已确认', '尚未确认', '有冲突'], required: false })
  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  verify_status?: string;
}

class CorrectEventDto {
  @ApiProperty({ description: '纠正后的原文', required: false })
  @IsOptional()
  @IsString()
  raw_text?: string;

  @ApiProperty({ description: '发生时间（UTC ISO8601）', required: false })
  @IsOptional()
  @IsString()
  occurred_at?: string;

  @ApiProperty({ description: '来源类型', enum: ['自述', '报告原文', '医生记录'], required: false })
  @IsOptional()
  @IsIn(['自述', '报告原文', '医生记录'])
  source_type?: string;

  @ApiProperty({ description: '核实状态', enum: ['已确认', '尚未确认', '有冲突'], required: false })
  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  verify_status?: string;
}

class LogTodayDto {
  @ApiProperty({ description: '日期 YYYY-MM-DD（缺省今天，北京时间）', required: false })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  date?: string;

  @ApiProperty({ description: '今天能坐多久（分钟），缺失=尚未确认', required: false, nullable: true })
  @IsOptional()
  @Min(0)
  @Max(1440)
  sit_minutes?: number | null;

  @ApiProperty({ description: '计划活动完成情况', enum: ['完成', '部分完成', '未完成', '尚未确认'], required: false, nullable: true })
  @IsOptional()
  @IsIn(['完成', '部分完成', '未完成', '尚未确认'])
  planned_activity_done?: string | null;

  @ApiProperty({ description: '睡眠影响程度 0-3', required: false, nullable: true })
  @IsOptional()
  @Min(0)
  @Max(3)
  sleep_impact?: number | null;

  @ApiProperty({ description: '当前最担心的问题', required: false, nullable: true })
  @IsOptional()
  @IsString()
  top_worry?: string | null;

  @ApiProperty({ description: '腿部变化', enum: ['有', '无', '尚未确认'], required: false, nullable: true })
  @IsOptional()
  @IsIn(['有', '无', '尚未确认'])
  leg_change?: string | null;

  @ApiProperty({ description: '今天是否选择跳过记录', required: false })
  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}

@ApiTags('病程记录')
@RequireConsent('健康信息处理')
@Controller('episodes')
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @ApiOperation({ summary: '我的病程列表' })
  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.episodes.list(user.id);
  }

  @ApiOperation({ summary: '创建病程（关键变化确认，缺失不默认阴性）' })
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateEpisodeDto) {
    return this.episodes.create(user.id, dto);
  }

  @ApiOperation({ summary: '病程详情（含病程事件）' })
  @Get(':id')
  detail(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.episodes.get(user.id, id);
  }

  @ApiOperation({ summary: '更新病程' })
  @Patch(':id')
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: UpdateEpisodeDto) {
    return this.episodes.update(user.id, id, dto);
  }

  @ApiOperation({ summary: '病程时间线（按日期分组）' })
  @Get(':id/timeline')
  timeline(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.episodes.timeline(user.id, id);
  }

  @ApiOperation({ summary: '今天的记录状态（没有则返回空，不返回昨日答案）' })
  @Get(':id/today')
  today(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.episodes.todayStatus(user.id, id);
  }

  @ApiOperation({ summary: '新增病程事件（症状 / 报告 / 医嘱 / 行动 / 结局）' })
  @Post(':id/events')
  addEvent(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.episodes.addEvent(user.id, id, dto);
  }

  @ApiOperation({ summary: '纠正病程事件（内容变化时核实状态降级为有冲突）' })
  @Patch(':id/events/:eventId')
  correctEvent(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() dto: CorrectEventDto,
  ) {
    return this.episodes.correctEvent(user.id, id, eventId, dto);
  }

  @ApiOperation({ summary: '删除病程事件' })
  @Delete(':id/events/:eventId')
  deleteEvent(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.episodes.deleteEvent(user.id, id, eventId);
  }

  @ApiOperation({ summary: '记录今天（字段可缺失，缺失显示尚未确认）' })
  @Post(':id/today-logs')
  logToday(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: LogTodayDto) {
    return this.episodes.logToday(user.id, id, dto);
  }
}
