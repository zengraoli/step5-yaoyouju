import { Module } from '@nestjs/common';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * SQLite 连接管理（演示实现替代原设计的 PostgreSQL 业务库与身份隔离库）：
 * - app.db：业务库（server/data/app.db）
 * - identity.db：身份隔离库（server/data/identity.db），字段加密
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly app: DatabaseSync;
  readonly identity: DatabaseSync;
  private readonly dataDir: string;

  constructor() {
    this.dataDir = path.resolve(process.env.DB_DIR ?? './data');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.app = this.open(path.join(this.dataDir, 'app.db'));
    this.identity = this.open(path.join(this.dataDir, 'identity.db'));
  }

  private open(file: string): DatabaseSync {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    return db;
  }

  onModuleDestroy(): void {
    try {
      this.app.close();
      this.identity.close();
    } catch {
      // 关闭失败不影响退出
    }
  }
}
