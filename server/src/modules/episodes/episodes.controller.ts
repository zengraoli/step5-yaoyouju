import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { EpisodesService } from './episodes.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CreateEpisodeDto {
  @IsString()
  title!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  onset_date?: string | null;

  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  onset_certainty?: string;
}

class UpdateEpisodeDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  onset_date?: string | null;

  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  onset_certainty?: string;

  @IsOptional()
  @IsIn(['进行中', '已结束'])
  status?: string;
}

class CreateEventDto {
  @IsIn(['报告', '症状', '医嘱', '行动', '结局'])
  event_type!: string;

  @IsString()
  occurred_at!: string;

  @IsIn(['自述', '报告原文', '医生记录'])
  source_type!: string;

  @IsOptional()
  @IsString()
  raw_text?: string | null;

  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  verify_status?: string;
}

class CorrectEventDto {
  @IsOptional()
  @IsString()
  raw_text?: string;

  @IsOptional()
  @IsString()
  occurred_at?: string;

  @IsOptional()
  @IsIn(['自述', '报告原文', '医生记录'])
  source_type?: string;

  @IsOptional()
  @IsIn(['已确认', '尚未确认', '有冲突'])
  verify_status?: string;
}

class LogTodayDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式应为 YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @Min(0)
  @Max(1440)
  sit_minutes?: number | null;

  @IsOptional()
  @IsIn(['完成', '部分完成', '未完成', '尚未确认'])
  planned_activity_done?: string | null;

  @IsOptional()
  @Min(0)
  @Max(3)
  sleep_impact?: number | null;

  @IsOptional()
  @IsString()
  top_worry?: string | null;

  @IsOptional()
  @IsIn(['有', '无', '尚未确认'])
  leg_change?: string | null;

  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}

@RequireConsent('健康信息处理')
@Controller('episodes')
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.episodes.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateEpisodeDto) {
    return this.episodes.create(user.id, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.episodes.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: UpdateEpisodeDto) {
    return this.episodes.update(user.id, id, dto);
  }

  @Get(':id/timeline')
  timeline(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.episodes.timeline(user.id, id);
  }

  @Get(':id/today')
  today(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.episodes.todayStatus(user.id, id);
  }

  @Post(':id/events')
  addEvent(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateEventDto,
  ) {
    return this.episodes.addEvent(user.id, id, dto);
  }

  @Patch(':id/events/:eventId')
  correctEvent(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() dto: CorrectEventDto,
  ) {
    return this.episodes.correctEvent(user.id, id, eventId, dto);
  }

  @Delete(':id/events/:eventId')
  deleteEvent(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.episodes.deleteEvent(user.id, id, eventId);
  }

  @Post(':id/today-logs')
  logToday(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: LogTodayDto) {
    return this.episodes.logToday(user.id, id, dto);
  }
}
