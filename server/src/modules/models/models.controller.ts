import { Body, ConflictException, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/api-error';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ModelReleasesService } from './models.service';
import { CurrentAdmin } from '../../common/current-admin.decorator';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../admin/permission.decorator';
import { AdminContext } from '../admin/admin-auth.service';
import { ConfirmationService } from '../admin/confirmation.service';

class CreateReleaseDto {
  @IsString()
  @MaxLength(50)
  model_name!: string;

  @IsString()
  @MaxLength(50)
  prompt_version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  retrieval_strategy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  content_lib_version?: string;
}

class RollbackReleaseDto {
  /** 回滚原因（必填，写入审计日志） */
  @IsString()
  @MaxLength(500)
  reason!: string;

  /** 双人确认单 ID（另一人确认后带上才生效） */
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

class PromoteDto {
  /** 双人确认单 ID（另一人确认后带上才生效） */
  @IsOptional()
  @IsString()
  confirmation_id?: string;
}

/**
 * 后台 · 模型发布管理（B08，T13）。
 *
 * 发布流程：候选 →（评测门禁）→ 灰度 → 生效，可回滚；生效中的发布被新发布顶替时自动回滚。
 * 门禁未通过时 promote 返回 40900（评测门禁未通过，不能生效）。
 *
 * T14：后台守卫（/admin）+ 技术角色权限 model.manage（越权 40300 并写审计）。
 */
@ApiTags('后台·模型发布')
@Controller('admin/models')
@RequirePermission('model.manage')
export class ModelsController {
  constructor(
    private readonly releases: ModelReleasesService,
    private readonly confirmations: ConfirmationService,
  ) {}

  /** 发布组合表：模型名、提示词版本、检索策略、内容库版本、状态、创建时间、最近评测结果 */
  @ApiOperation({ summary: '模型发布组合表（含最近评测结果）' })
  @Get()
  list() {
    return this.releases.list();
  }

  /** 创建候选发布（状态=候选） */
  @ApiOperation({ summary: '创建候选发布（状态=候选）' })
  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateReleaseDto) {
    return this.releases.create(
      {
        model_name: dto.model_name,
        prompt_version: dto.prompt_version,
        retrieval_strategy: dto.retrieval_strategy,
        content_lib_version: dto.content_lib_version,
      },
      user?.id ?? null,
    );
  }

  /** 提升一级（候选→灰度→生效）；门禁未通过返回 40900 */
  @ApiOperation({ summary: '提升发布一级（候选→灰度→生效；门禁未通过返回 40900）' })
  @Post(':id/promote')
  promote(@CurrentAdmin() admin: AdminContext, @Param('id') id: string, @Body() dto: PromoteDto) {
    // 先过评测门禁：门禁没过就没有必要请第二个人确认
    const gateStatus = this.releases.gateStatusOf(id);
    if (!gateStatus.passed) {
      throw new ConflictException(
        '评测门禁未通过，不能生效：' +
          (gateStatus.missing.length > 0 ? '缺少必需评测集（' + gateStatus.missing.join('、') + '）' : '') +
          (gateStatus.blocked.length > 0 ? '最近一次评测未通过（' + gateStatus.blocked.join('、') + '）' : ''),
      );
    }
    const gate = this.confirmations.prepare(
      'model.promote',
      id,
      '模型发布提升',
      dto.confirmation_id ? '另一人已确认的模型发布提升' : '模型发布提升',
      admin,
      dto.confirmation_id,
    );
    if (!gate.proceed) {
      throw new ConflictException(
        '已提交「模型发布提升」双人确认申请（需' + (gate.confirmation?.requirement ?? '另一人') + '确认后生效）',
      );
    }
    const result = this.releases.promote(id, admin.id);
    if (gate.confirmation) this.confirmations.markApplied(gate.confirmation.id);
    return result;
  }

  /** 回滚（必须填写原因，写审计日志） */
  @ApiOperation({ summary: '回滚发布（必须填原因，写审计）' })
  @Post(':id/rollback')
  rollback(@CurrentAdmin() admin: AdminContext, @Param('id') id: string, @Body() dto: RollbackReleaseDto) {
    const reasonText = (dto.reason ?? '').trim();
    if (!reasonText) throw new ApiException(ErrorCode.BAD_REQUEST, '回滚原因不能为空');
    if (this.releases.isLastActive(id)) {
      throw new ConflictException(
        '这是唯一生效的发布，回滚后新分析会全部失败；请先把另一个通过门禁的发布提升为生效',
      );
    }
    const gate = this.confirmations.prepare(
      'model.rollback',
      id,
      '模型发布回滚',
      dto.confirmation_id ? '另一人已确认的模型发布回滚：' + dto.reason : '模型发布回滚：' + dto.reason,
      admin,
      dto.confirmation_id,
    );
    if (!gate.proceed) {
      throw new ConflictException(
        '已提交「模型发布回滚」双人确认申请（需' + (gate.confirmation?.requirement ?? '另一人') + '确认后生效）',
      );
    }
    const result = this.releases.rollback(id, dto.reason, admin.id);
    if (gate.confirmation) this.confirmations.markApplied(gate.confirmation.id);
    return result;
  }
}
