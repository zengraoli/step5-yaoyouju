import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DbService } from './db.service';
import { APP_DDL, IDENTITY_DDL } from './schema';
import { seedIfEmpty } from './seed';
import { FieldCrypto } from './crypto.service';

/**
 * 启动时自动建表并写入种子数据（幂等：重复启动不会重复写入）。
 */
@Injectable()
export class SchemaService implements OnModuleInit {
  private readonly logger = new Logger('Schema');

  constructor(private readonly db: DbService) {}

  onModuleInit(): void {
    this.db.app.exec(APP_DDL);
    this.db.identity.exec(IDENTITY_DDL);
    const seeded = seedIfEmpty(this.db.app, this.db.identity, FieldCrypto.fromEnv(this.db.dataDir));
    this.logger.log(seeded ? '数据库结构就绪，已写入演示种子数据' : '数据库结构就绪，已有数据跳过种子写入');
  }
}
