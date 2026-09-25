import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { FollowupService } from './followup.service';
import { FollowupController } from './followup.controller';

/**
 * 复诊摘要服务（/episodes/{id}/followup）
 * 固定六段（起病与时间 / 当前症状 / 检查与报告 / 既往医嘱与行动 / 我的主要担心 / 想请医生确认的问题）；
 * 区分自述 / 报告原文 / 医生记录，未核实项保留并带「未经核实」标记，报告未描述显示「报告未提及」；
 * 支持预览后纠正（编辑文字、增删问题、调整顺序）与导出（文本必做，PDF / 图片由浏览器打印生成）。
 */
@Module({
  imports: [DbModule],
  controllers: [FollowupController],
  providers: [FollowupService],
})
export class FollowupModule {}
