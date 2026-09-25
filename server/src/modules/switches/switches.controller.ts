import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/public.decorator';
import { SwitchesService } from './switches.service';

/** 客户端读取功能开关状态（公开，不携带用户数据） */
@ApiTags('功能开关')
@Controller('switches')
export class SwitchesController {
  constructor(private readonly switches: SwitchesService) {}

  @Public()
  @ApiOperation({ summary: '功能开关状态（公开：个性化分析 / 视频推荐 / 拍照提取 / 案例卡片）' })
  @Get()
  list() {
    return this.switches.list();
  }
}
