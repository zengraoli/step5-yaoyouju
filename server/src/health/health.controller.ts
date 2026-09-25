import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../common/public.decorator';

@ApiTags('健康检查')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @ApiOperation({ summary: '健康检查（公开，冒烟脚本先探测本接口确认服务已启动）' })
  @Get()
  check() {
    return this.health.check();
  }
}
