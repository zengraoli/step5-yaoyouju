import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { SafetyModule } from '../safety/safety.module';
import { SwitchesModule } from '../switches/switches.module';
import { AnalysesService } from './analyses.service';
import { AnalysesController } from './analyses.controller';

/**
 * 分析编排服务（/analyses）
 * 创建分析任务、投递到 SQLite 任务表、查询一页分析结果。
 * 生成由独立 Worker 进程消费（src/worker/main.ts → analysis-pipeline.ts）。
 */
@Module({
  imports: [DbModule, SafetyModule, SwitchesModule],
  controllers: [AnalysesController],
  providers: [AnalysesService],
  exports: [AnalysesService],
})
export class AnalysesModule {}
