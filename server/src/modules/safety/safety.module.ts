import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { SafetyService } from './safety.service';
import { SafetyNoticeController } from './safety.controller';

/**
 * 安全规则引擎（被分析编排服务调用）
 * - 红旗规则 RF-xx + 服务范围校验 OOS-xx（规则集版本见 safety.rules.ts）
 * - 命中写安全事件（规则、严重度、动作、来源）
 * - 就医提示为公开接口，无需登录（R03：不被登录阻断）
 */
@Module({
  imports: [DbModule],
  controllers: [SafetyNoticeController],
  providers: [SafetyService],
  exports: [SafetyService],
})
export class SafetyModule {}
