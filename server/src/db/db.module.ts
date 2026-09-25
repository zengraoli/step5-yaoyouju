import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { SchemaService } from './schema.service';

@Module({
  providers: [DbService, SchemaService],
  exports: [DbService],
})
export class DbModule {}
