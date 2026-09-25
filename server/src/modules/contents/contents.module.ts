import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { SwitchesModule } from '../switches/switches.module';
import { ContentsService } from './contents.service';
import { ContentsController } from './contents.controller';

/**
 * 内容库服务（/contents）。
 * T10：审核状态机（草稿 → 待医学审核 → 已审定 → 已发布 → 已撤回 / 已下线 / 更正中）、
 * 双人确认发布、一键下线与引用定位、用户端已发布内容列表与详情；
 * 状态流转方法设计为可被后台（B03 / B04，T31-T39）复用。
 */
@Module({
  imports: [DbModule, SwitchesModule],
  controllers: [ContentsController],
  providers: [ContentsService],
})
export class ContentsModule {}
