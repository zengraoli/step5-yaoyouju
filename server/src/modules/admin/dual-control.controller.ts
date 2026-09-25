import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { AdminContext } from './admin-auth.service';
import { DualControlService, DualControlSettings } from './dual-control.service';
import { RequirePermission } from './permission.decorator';

class UpdateDualControlDto {
  @IsBoolean({ message: 'enabled 必须为布尔值' })
  enabled!: boolean;

  /** 变更原因（必填，写入审计） */
  @IsString()
  @MaxLength(200)
  reason!: string;
}

/**
 * 双人确认设置（T14，B10）。
 * 读取与变更都要求 dual_control.manage（合规 / 超级管理），变更写审计。
 */
@Controller('admin/dual-control')
@RequirePermission('dual_control.manage')
export class AdminDualControlController {
  constructor(private readonly dualControl: DualControlService) {}

  @Get('settings')
  getSettings(): DualControlSettings {
    return this.dualControl.getSettings();
  }

  @Put('settings')
  updateSettings(@CurrentAdmin() admin: AdminContext, @Body() dto: UpdateDualControlDto): DualControlSettings {
    return this.dualControl.updateSettings(dto.enabled, dto.reason, admin.id);
  }
}
