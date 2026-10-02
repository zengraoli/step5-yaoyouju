import { Injectable, Logger } from '@nestjs/common';
import { ApiException, ErrorCode } from '../../common/api-error';
import { AdminContext, AdminAuthService } from './admin-auth.service';
import { ClaimedConfirmation } from './confirmation.service';
import { DualControlService } from './dual-control.service';
import { AdminUsersService } from './admin-users.service';
import { ContentsService } from '../contents/contents.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ModelReleasesService } from '../models/models.service';
import { SwitchesService } from '../switches/switches.service';
import { HIGH_RISK_SWITCHES } from './admin.constants';

/**
 * 双人确认的业务执行器（验收反馈第 30 条： approve 不能只把单据改成「已生效」）。
 * 由 /admin/confirmations/:id/approve 调用：领到执行权后真正完成业务变更并写审计。
 */
@Injectable()
export class ConfirmationExecutor {
  private readonly logger = new Logger('ConfirmationExecutor');

  constructor(
    private readonly contents: ContentsService,
    private readonly feedback: FeedbackService,
    private readonly releases: ModelReleasesService,
    private readonly dualControl: DualControlService,
    private readonly users: AdminUsersService,
    private readonly switches: SwitchesService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  execute(claimed: ClaimedConfirmation, admin: AdminContext): unknown {
    const payload = claimed.payload ?? {};
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    switch (claimed.action) {
      case 'content.offline':
        return this.contents.takeOffline(admin.id, admin, claimed.target_id, {
          reason: text(payload.reason) || '批量下线',
          confirmation_id: claimed.id,
        });
      case 'content.withdraw':
        return this.contents.withdraw(admin.id, admin, claimed.target_id, {
          reason: text(payload.reason) || '发现严重问题',
          confirmation_id: claimed.id,
        });
      case 'content.publish':
        // 运营编辑发起、临床审核 / 超级管理员确认后由确认人执行发布
        return this.contents.publish(admin.id, claimed.target_id);
      case 'switch.update': {
        if (typeof payload.enabled !== 'boolean') {
          // 没有携带目标状态（旧确认单 / 手工构造）：拒绝执行，避免把开关改成错误状态
          throw new ApiException(ErrorCode.CONFLICT, '该确认单没有记录目标开关状态，请撤销后重新发起');
        }
        const enabled = payload.enabled as boolean;
        const reason = text(payload.reason) || '后台变更';
        const result = this.switches.setEnabled(claimed.target_id, enabled, reason, admin.id);
        this.logger.log(`[confirm] 执行高危开关变更 ${claimed.target_id} → ${enabled ? '开启' : '关闭'}`);
        return result;
      }
      case 'model.promote':
        return this.releases.promote(claimed.target_id, admin.id);
      case 'model.rollback':
        return this.releases.rollback(claimed.target_id, text(payload.reason) || '回滚', admin.id);
      case 'dual_control.update':
        return this.dualControl.updateSettings(Boolean(payload.enabled), text(payload.reason) || '变更双人确认设置', admin.id);
      case 'feedback.authorize':
        return this.feedback.authorizeView(claimed.target_id, admin.id, {
          scope: text(payload.scope) || '本条举报的用户原始内容',
          confirmation_id: claimed.id,
        });
      case 'user.status':
        return this.users.setStatus(admin, claimed.target_id, {
          active: Boolean(payload.active),
          reason: text(payload.reason),
          confirmation_id: claimed.id,
        });
      case 'user.invite_super':
        return this.users.createInvitedSuper(text(payload.name), claimed.id, payload, admin.id);
      case 'user.mfa_reset_super':
        return this.users.resetMfa(admin, claimed.target_id, claimed.id);
      case 'feedback.report_handling':
        return this.feedback.handle(claimed.target_id, admin.id, {
          action: text(payload.action) as never,
          comment: text(payload.comment),
        });
      default:
        throw new ApiException(ErrorCode.BAD_REQUEST, `未知的确认动作：${claimed.action}`);
    }
  }

  /** 待确认单列表里提示「该动作是高风险操作」用 */
  static isHighRisk(action: string): boolean {
    return HIGH_RISK_SWITCHES.length >= 0 && action.startsWith('model.');
  }
}
