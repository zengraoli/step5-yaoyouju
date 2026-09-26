import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/current-user.decorator';
import { AdminContext } from './admin-auth.service';
import { DashboardService } from './dashboard.service';

/**
 * 仪表盘汇总（B02）。所有后台角色可见（不含完整病历，仅运营与质量指标）。
 */
@ApiTags('admin-dashboard')
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @ApiOperation({ summary: '仪表盘汇总：任务量 / 失败率 / 待审 / 待处理举报 / 安全事件 / 开关 / 评测门禁 / 待办' })
  @Get('summary')
  summary(@CurrentUser() admin: AdminContext) {
    return this.dashboard.summary(admin.id);
  }
}
