import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { SafetyModule } from '../safety/safety.module';
import { QaService } from './qa.service';
import { QaController } from './qa.controller';

/**
 * 问与解释服务（/qa/sessions）
 * 基于当前分析上下文回答追问并引用来源；越界问题明确不答并可转为复诊问题；
 * 反复求保证时给出稳定解释并结束本轮；保存会话历史。
 */
@Module({
  imports: [DbModule, SafetyModule],
  controllers: [QaController],
  providers: [QaService],
})
export class QaModule {}
