import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuditService } from '../../common/audit.service';
import { ConfirmationService, CONFIRMATION_RULES } from './confirmation.service';
import { AdminConfirmationsController } from './admin-confirmations.controller';

/**
 * 双人确认（B10 / 验收反馈第 10 条）。
 * 单独成模块：内容、证据、模型、开关等模块都要复用同一张确认单表，
 * 避免循环依赖。所有高风险动作必须「另一名具备对应角色的账号」确认后才会执行。
 */
@Module({
  imports: [DbModule],
  controllers: [AdminConfirmationsController],
  providers: [ConfirmationService, AuditService],
  exports: [ConfirmationService],
})
export class ConfirmationModule {}
