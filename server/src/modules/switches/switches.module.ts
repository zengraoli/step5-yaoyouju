import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { AuditService } from '../../common/audit.service';
import { SwitchesService } from './switches.service';
import { SwitchesController } from './switches.controller';

@Module({
  imports: [DbModule],
  controllers: [SwitchesController],
  providers: [AuditService, SwitchesService],
  exports: [SwitchesService, AuditService],
})
export class SwitchesModule {}
