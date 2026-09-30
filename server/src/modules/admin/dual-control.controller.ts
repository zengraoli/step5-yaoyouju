import { Body, ConflictException, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { AdminContext } from './admin-auth.service';
import { DualControlService, DualControlSettings } from './dual-control.service';
import { ConfirmationService } from './confirmation.service';
import { RequirePermission } from './permission.decorator';

class UpdateDualControlDto {
  @IsBoolean({ message: 'enabled 必须为布尔值' })
  enabled!: boolean;

  /** 变更原因（必填，写入审计） */
  @IsString()
  @MaxLength(200)
  reason!: string;

  /** 双人确认单 ID（另一名超级管理员确认后带上才生效） */
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

/**
 * 双人确认设置（T14，B10）。
 * 读取与变更都要求 dual_control.manage（合规 / 超级管理），变更写审计。
 */
@ApiTags('后台·双人确认')
@Controller('admin/dual-control')
@RequirePermission('dual_control.manage')
export class AdminDualControlController {
  constructor(
    private readonly dualControl: DualControlService,
    private readonly confirmations: ConfirmationService,
  ) {}

  @ApiOperation({ summary: '读取双人确认设置' })
  @Get('settings')
  getSettings(): DualControlSettings {
    return this.dualControl.getSettings();
  }

  @ApiOperation({ summary: '变更双人确认设置（必须填原因，写审计）' })
  @Put('settings')
  updateSettings(@CurrentAdmin() admin: AdminContext, @Body() dto: UpdateDualControlDto): DualControlSettings {
    const gate = this.confirmations.prepare(
      'dual_control.update',
      '发布双人确认',
      '双人确认设置',
      dto.confirmation_id ? '另一人已确认：' + dto.reason : '变更双人确认设置：' + dto.reason,
      admin,
      dto.confirmation_id,
    );
    if (!gate.proceed) {
      throw new ConflictException(
        '已提交「双人确认设置」变更申请（需' + (gate.confirmation?.requirement ?? '另一人') + '确认后生效）',
      );
    }
    const result = this.dualControl.updateSettings(dto.enabled, dto.reason, admin.id);
    if (gate.confirmation) this.confirmations.markApplied(gate.confirmation.id);
    return result;
  }
}
