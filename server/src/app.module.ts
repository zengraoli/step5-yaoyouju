import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { ConsentGuard } from './common/consent.guard';
import { EpisodesModule } from './modules/episodes/episodes.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AnalysesModule } from './modules/analyses/analyses.module';
import { SafetyModule } from './modules/safety/safety.module';
import { ContentsModule } from './modules/contents/contents.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { ModelsModule } from './modules/models/models.module';
import { AdminModule } from './modules/admin/admin.module';
import { SwitchesModule } from './modules/switches/switches.module';

/**
 * 按 docs/system-design.md 第 1 节划分模块（模块化单体 + AI Worker）：
 * - auth：用户与授权（/auth）
 * - episodes：病程记录服务（/episodes）
 * - reports：报告解析服务（/reports）
 * - analyses：分析编排服务（/analyses）
 * - safety：安全规则引擎（被分析编排调用，命中写安全事件）
 * - contents：内容库服务（/contents）
 * - evidence：证据库检索（Worker 侧受控检索）
 * - feedback：反馈与质量服务（/feedback）
 * - models：模型发布与评测（/admin 侧由后台使用）
 * - admin：后台管理与审计（/admin）
 * - switches：功能开关（个性化分析 / 视频推荐 / 案例卡片）
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DbModule,
    SwitchesModule,
    AuthModule,
    EpisodesModule,
    ReportsModule,
    AnalysesModule,
    SafetyModule,
    ContentsModule,
    EvidenceModule,
    FeedbackModule,
    ModelsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    // 全局守卫：先校验登录，再校验「健康信息处理」同意（标注 @Public() 的路由跳过）
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ConsentGuard },
  ],
})
export class AppModule {}
