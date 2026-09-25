import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ModelReleasesService } from './models.service';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../admin/permission.decorator';

class CreateReleaseDto {
  @IsString()
  @MaxLength(50)
  model_name!: string;

  @IsString()
  @MaxLength(50)
  prompt_version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  retrieval_strategy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  content_lib_version?: string;
}

class RollbackReleaseDto {
  /** 回滚原因（必填，写入审计日志） */
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/**
 * 后台 · 模型发布管理（B08，T13）。
 *
 * 发布流程：候选 →（评测门禁）→ 灰度 → 生效，可回滚；生效中的发布被新发布顶替时自动回滚。
 * 门禁未通过时 promote 返回 40900（评测门禁未通过，不能生效）。
 *
 * T14：后台守卫（/admin）+ 技术角色权限 model.manage（越权 40300 并写审计）。
 */
@Controller('admin/models')
@RequirePermission('model.manage')
export class ModelsController {
  constructor(private readonly releases: ModelReleasesService) {}

  /** 发布组合表：模型名、提示词版本、检索策略、内容库版本、状态、创建时间、最近评测结果 */
  @Get()
  list() {
    return this.releases.list();
  }

  /** 创建候选发布（状态=候选） */
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateReleaseDto) {
    return this.releases.create(
      {
        model_name: dto.model_name,
        prompt_version: dto.prompt_version,
        retrieval_strategy: dto.retrieval_strategy,
        content_lib_version: dto.content_lib_version,
      },
      user?.id ?? null,
    );
  }

  /** 提升一级（候选→灰度→生效）；门禁未通过返回 40900 */
  @Post(':id/promote')
  promote(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.releases.promote(id, user?.id ?? null);
  }

  /** 回滚（必须填写原因，写审计日志） */
  @Post(':id/rollback')
  rollback(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: RollbackReleaseDto) {
    return this.releases.rollback(id, dto.reason, user?.id ?? null);
  }
}
