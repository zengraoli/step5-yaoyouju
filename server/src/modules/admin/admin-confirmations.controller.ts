import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { RequirePermission } from './permission.decorator';
import { AdminContext } from './admin-auth.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { ConfirmationService, CONFIRMATION_RULES } from './confirmation.service';
import { Public } from '../../common/public.decorator';

class RequestDto {
  @ApiProperty({ description: '动作', enum: Object.keys(CONFIRMATION_RULES) })
  @IsString()
  action!: string;

  @ApiProperty({ description: '目标 ID（内容 / 模型 / 开关 key 等）' })
  @IsString()
  target_id!: string;

  @ApiProperty({ description: '目标说明（界面展示用）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  target_label?: string;

  @ApiProperty({ description: '业务参数（JSON，确认后由服务端执行）', required: false })
  @IsOptional()
  @IsString()
  payload?: string;

  @ApiProperty({ description: '变更原因（写审计）' })
  @IsString()
  @MaxLength(500)
  note!: string;
}

class RejectDto {
  @ApiProperty({ description: '驳回原因（写审计）' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

/**
 * 双人确认（B10 / 验收反馈第 10 条）：
 * 发起确认单 → 另一名具备对应角色的账号确认 → 服务端执行真正的高风险变更。
 * 与「设置」里的「发布双人确认」开关的关系：内容发布的双人确认沿用既有审核记录，
 * 其余高风险动作（撤回 / 下线 / 高危开关 / 模型提升与回滚 / 单条授权 / 成员停用）统一走本接口。
 */
@ApiTags('admin-confirmations')
@Controller('admin/confirmations')
export class AdminConfirmationsController {
  constructor(private readonly confirmations: ConfirmationService) {}

  @Public()
  @ApiOperation({ summary: '各动作的双人确认要求（B10 设置卡片）' })
  @Get('rules')
  rules() {
    return { items: this.confirmations.requirements() };
  }

  @ApiOperation({ summary: '确认单列表（默认待确认）' })
  @Get()
  list() {
    return { items: this.confirmations.list() };
  }

  @ApiOperation({ summary: '发起确认单（高风险动作必须双人确认后才能生效）' })
  @Post()
  request(@CurrentAdmin() admin: AdminContext, @Body() dto: RequestDto) {
    let payload: Record<string, unknown> = {};
    if (dto.payload) {
      try {
        const parsed = JSON.parse(dto.payload) as unknown;
        payload = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      } catch {
        throw new (class extends Error {})('payload 不是合法的 JSON');
      }
    }
    return this.confirmations.request(
      dto.action,
      dto.target_id,
      payload,
      dto.note,
      admin,
      dto.target_label ?? '',
    );
  }

  @ApiOperation({ summary: '确认并执行（不能与发起人是同一人）' })
  @Post(':id/approve')
  approve(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    const claimed = this.confirmations.claim(id, admin);
    // 业务执行由各模块的控制器路由完成（见 admin-contents / admin-safety / models / dual-control）
    return { claimed, execute: claimed.action };
  }

  @ApiOperation({ summary: '驳回确认单' })
  @Post(':id/reject')
  reject(@CurrentAdmin() admin: AdminContext, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.confirmations.reject(id, admin, dto.reason);
  }

  @ApiOperation({ summary: '撤销自己发起的确认单' })
  @Post(':id/cancel')
  cancel(@CurrentAdmin() admin: AdminContext, @Param('id') id: string) {
    return this.confirmations.cancel(id, admin);
  }
}
