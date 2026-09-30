import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { SchemaService } from './schema.service';
import { TokenRevocationService } from '../common/token-revocation.service';

@Module({
  providers: [DbService, SchemaService, TokenRevocationService],
  exports: [DbService, TokenRevocationService],
})
export class DbModule {}
