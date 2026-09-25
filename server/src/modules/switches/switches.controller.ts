import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/public.decorator';
import { SwitchesService } from './switches.service';

/** 客户端读取功能开关状态（公开，不携带用户数据） */
@Controller('switches')
export class SwitchesController {
  constructor(private readonly switches: SwitchesService) {}

  @Public()
  @Get()
  list() {
    return this.switches.list();
  }
}
