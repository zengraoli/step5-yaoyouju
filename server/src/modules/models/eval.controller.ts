import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { EvalCase } from './eval-scorer';
import { EvalService } from './eval.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../admin/permission.decorator';

class CreateEvalSetDto {
  /** 评测集名称（如 错误安慰 / 关键遗漏 / 左右侧混淆 / 隐私） */
  @IsString()
  @MaxLength(50)
  name!: string;

  /** 演示用例（类别 / 输入 / 期望 / 本地模拟输出），逐条在服务内校验 */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  cases!: EvalCase[];
}

class RunEvalDto {
  @IsString()
  model_release_id!: string;

  @IsString()
  eval_set_id!: string;

  /** 触发原因（如 发布前门禁 / 每日回归 / 举报复盘） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trigger_reason?: string;
}

/**
 * 后台 · 评测集与回归结果（B09，T13）。
 *
 * - 评测集列表（来源与门禁）与运行记录（触发原因）；
 * - 失败用例（输入 / 期望 / 实际 / 判定）去标识化：手机号 138****1234、姓名「用户」；
 * - runEval 的 result 由 metrics 决定：任一类别失败数 > 0 → 阻断发布。
 *
 * T14：后台守卫（/admin）+ 技术角色权限 eval.manage（越权 40300 并写审计）。
 */
@ApiTags('后台·评测回归')
@Controller('admin/eval')
@RequirePermission('eval.manage')
export class EvalController {
  constructor(private readonly evalService: EvalService) {}

  /** 评测集列表：名称、用例数、是否去标识化、最近一次运行结果 */
  @ApiOperation({ summary: '评测集列表（名称 / 用例数 / 是否去标识化 / 最近运行结果）' })
  @Get('sets')
  listSets() {
    return this.evalService.listSets();
  }

  /** 新建评测集（演示用例，deidentified=true） */
  @ApiOperation({ summary: '新建评测集（演示用例，deidentified=true）' })
  @Post('sets')
  createSet(@CurrentUser() user: { id: string }, @Body() dto: CreateEvalSetDto) {
    return this.evalService.createSet({ name: dto.name, cases: dto.cases }, user?.id ?? null);
  }

  /** 运行记录：触发原因、时间、指标、结果（可按评测集筛选） */
  @ApiOperation({ summary: '评测运行记录（触发原因 / 时间 / 指标 / 结果）' })
  @Get('runs')
  listRuns(@Query('eval_set_id') evalSetId?: string) {
    return this.evalService.listRuns(evalSetId);
  }

  /** 运行评测：逐用例「生成 + 核对」，输出 metrics 与失败用例（去标识化） */
  @ApiOperation({ summary: '运行评测（逐用例生成 + 核对，失败用例去标识化）' })
  @Post('runs')
  runEval(@CurrentUser() user: { id: string }, @Body() dto: RunEvalDto) {
    return this.evalService.runEval(
      dto.model_release_id,
      dto.eval_set_id,
      dto.trigger_reason,
      user?.id ?? null,
    );
  }

  /** 运行详情（含失败用例） */
  @ApiOperation({ summary: '评测运行详情（含失败用例）' })
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.evalService.getRun(id);
  }
}
