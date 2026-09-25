import { Module } from '@nestjs/common';
import { SafetyNoticeController } from './safety.controller';

/**
 * 安全规则引擎（被分析编排服务调用）
 * T04 补充：红旗信号与服务范围校验，命中写安全事件（SAFETY_EVENT）。
 * 就医提示为公开接口，无需登录（R03：不被登录阻断）。
 */
@Module({
  controllers: [SafetyNoticeController],
})
export class SafetyModule {}
