import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { SwitchesModule } from '../switches/switches.module';
import { ReportsService } from './reports.service';
import { ReportsController, EpisodeReportsController } from './reports.controller';

/**
 * 报告解析服务（/reports）
 * 粘贴文字为主、拍照提取为模拟 OCR；术语抽取并记录原文位置；结构化核对。
 */
@Module({
  imports: [DbModule, SwitchesModule],
  controllers: [ReportsController, EpisodeReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
