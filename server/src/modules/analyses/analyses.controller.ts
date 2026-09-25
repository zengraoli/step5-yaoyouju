import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Response } from 'express';
import { AnalysesService } from './analyses.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequireConsent } from '../../common/require-consent.decorator';

class CreateAnalysisDto {
  @IsString()
  episode_id!: string;

  /** 症状变化（可选，参与红旗校验） */
  @IsOptional()
  @IsString()
  symptom_change?: string;

  /** 报告原文（可选，参与红旗校验与检索） */
  @IsOptional()
  @IsString()
  report_text?: string;

  /** 主要困惑 / 提问（可选，参与红旗校验） */
  @IsOptional()
  @IsString()
  question?: string;
}

/**
 * 分析编排服务（/analyses）。
 * 需登录 + 同意「健康信息处理」（全局守卫）。
 */
@RequireConsent('健康信息处理')
@Controller('analyses')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  /**
   * 提交分析：红旗校验 → 开关判断 → 创建排队任务。
   * - 命中 high → 40910/40911 + 就医提示（不创建任务）
   * - 开关关闭 → 200 + 回退结果
   * - 通过 → 202 + 任务 ID（medium 命中附安全提示）
   */
  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateAnalysisDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.analyses.create(user.id, dto);
    res.status(result.status === 'queued' ? 202 : 200);
    return result;
  }

  /** 查询任务状态与结果（排队中 / 完成 / 失败回退） */
  @Get('task/:taskId')
  task(@CurrentUser() user: { id: string }, @Param('taskId') taskId: string) {
    return this.analyses.getTask(user.id, taskId);
  }

  /** 一页分析详情（已知 / 解释 / 未知 / 下一步 / 视频 + disclaimer） */
  @Get(':id')
  detail(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.analyses.get(user.id, id);
  }
}
