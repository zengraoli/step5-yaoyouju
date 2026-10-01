import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { ConfirmationModule } from './confirmation.module';
import { SwitchesModule } from '../switches/switches.module';
import { ContentsModule } from '../contents/contents.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { ModelsModule } from '../models/models.module';
import { AuditService } from '../../common/audit.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminSafetyController } from './admin-safety.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminCasesController } from './admin-cases.controller';
import { DashboardService } from './dashboard.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminRolesController } from './admin-roles.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuthorizationsController } from './admin-authorizations.controller';
import { DualControlService } from './dual-control.service';
import { AdminDualControlController } from './dual-control.controller';
import { ConfirmationService } from './confirmation.service';
import { ConfirmationExecutor } from './confirmation.executor';
import { AdminConfirmationsController } from './admin-confirmations.controller';

/**
 * 后台管理与审计（/admin，T14）。
 * - 后台登录（账号 + 口令 + TOTP，失败锁定，短会话）与账号信息；
 * - 角色权限矩阵（最小必要）与 @RequirePermission 校验（PermissionGuard）；
 * - 单条授权记录查询、双人确认设置与 check；
 * - 双人确认：发起 → 另一名具备对应角色的账号确认 → 服务端执行业务（ConfirmationExecutor）；
 * - 审计日志只追加（数据库触发器 + 哈希链）、筛选分页、哈希链校验、导出需审批。
 * 导出 AdminAuthService 供全局 AdminGuard 注入。
 */
@Module({
  imports: [
    SwitchesModule,
    DbModule,
    ConfirmationModule,
    ContentsModule,
    FeedbackModule,
    ModelsModule,
  ],
  controllers: [
    AdminCasesController,
    AdminUsersController,
    AdminSafetyController,
    AdminDashboardController,
    AdminAuthController,
    AdminRolesController,
    AdminAuditController,
    AdminAuthorizationsController,
    AdminDualControlController,
    AdminConfirmationsController,
  ],
  providers: [
    DashboardService,
    AdminAuthService,
    AdminAuditService,
    DualControlService,
    AuditService,
    ConfirmationService,
    ConfirmationExecutor,
    AdminUsersService,
  ],
  exports: [AdminAuthService, ConfirmationService],
})
export class AdminModule {}
