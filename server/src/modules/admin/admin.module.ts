import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuditService } from '../../common/audit.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminRolesController } from './admin-roles.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuthorizationsController } from './admin-authorizations.controller';
import { DualControlService } from './dual-control.service';
import { AdminDualControlController } from './dual-control.controller';

/**
 * 后台管理与审计（/admin，T14）。
 * - 后台登录（账号 + 口令 + TOTP，失败锁定，短会话）与账号信息；
 * - 角色权限矩阵（最小必要）与 @RequirePermission 校验（PermissionGuard）；
 * - 单条授权记录查询、双人确认设置与 check；
 * - 审计日志只追加（数据库触发器 + 哈希链）、筛选分页、哈希链校验、导出需审批。
 * 导出 AdminAuthService 供全局 AdminGuard 注入。
 */
@Module({
  imports: [DbModule],
  controllers: [
    AdminDashboardController,
    AdminAuthController,
    AdminRolesController,
    AdminAuditController,
    AdminAuthorizationsController,
    AdminDualControlController,
  ],
  providers: [
    DashboardService,AdminAuthService, AdminAuditService, DualControlService, AuditService],
  exports: [AdminAuthService],
})
export class AdminModule {}
