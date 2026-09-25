import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuditService } from '../../common/audit.service';
import { ModelReleasesService } from './models.service';
import { ModelsController } from './models.controller';
import { EvalService } from './eval.service';
import { EvalController } from './eval.controller';

/**
 * 模型发布与评测（/admin 侧由后台使用）。
 * T13：模型发布组合、评测集、评测运行与门禁结果。
 * - models.service：发布组合与状态流转（候选 → 灰度 → 生效，可回滚）；
 * - eval.service：评测集与运行记录、本地模拟评分器（eval-scorer）与发布门禁。
 */
@Module({
  imports: [DbModule],
  controllers: [ModelsController, EvalController],
  providers: [AuditService, EvalService, ModelReleasesService],
  exports: [EvalService, ModelReleasesService],
})
export class ModelsModule {}
