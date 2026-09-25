import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { EpisodesService } from './episodes.service';
import { EpisodesController } from './episodes.controller';

/**
 * 病程记录服务（/episodes）
 * 病程与病程事件（自述 / 报告原文 / 医生记录）、记录今天、时间线；
 * 用户可纠正、删除自己的记录；缺失字段一律「尚未确认」。
 */
@Module({
  imports: [DbModule],
  controllers: [EpisodesController],
  providers: [EpisodesService],
  exports: [EpisodesService],
})
export class EpisodesModule {}
