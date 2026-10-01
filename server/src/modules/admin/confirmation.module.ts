import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuditService } from '../../common/audit.service';
import { ConfirmationService } from './confirmation.service';

/**
 * 双人确认（B10 / 验收反馈第 9、10、30 条）。
 * 单独成模块：内容、证据、模型、开关等模块都要复用同一张确认单表，
 * 避免循环依赖。所有高风险动作必须「另一名具备对应角色的账号」确认后才会执行。
 * 确认单的接口（/admin/confirmations）注册在 AdminModule（业务执行器在那边）。
 */
@Module({
  imports: [DbModule],
  providers: [ConfirmationService, AuditService],
  exports: [ConfirmationService],
})
export class ConfirmationModule {}
