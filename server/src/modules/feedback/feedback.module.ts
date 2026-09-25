import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuditService } from '../../common/audit.service';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { AdminFeedbackController } from './admin-feedback.controller';

/**
 * 反馈与质量服务（/feedback + /admin/feedback）。
 * T12：帮助类型反馈（看懂了 / 知道下一步 / 都不好 + 未解决问题）、
 * 错误举报（自动附带分析 / 模型 / 内容 / 规则集四类版本，按严重度分级）、
 * 单条授权查看用户原始内容、处置动作与处理记录。
 * 产品红线：反馈与举报不自动进入训练或内容库。
 * 后台登录鉴权（账号 + TOTP + 角色权限）留待 T14 / T35，本任务用全局登录守卫占位。
 */
@Module({
  imports: [DbModule],
  controllers: [FeedbackController, AdminFeedbackController],
  providers: [FeedbackService, AuditService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
