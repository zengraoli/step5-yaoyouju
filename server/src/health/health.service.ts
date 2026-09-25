import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class HealthService {
  constructor(private readonly db: DbService) {}

  check() {
    let dbOk = false;
    try {
      this.db.app.prepare('SELECT 1 AS ok').get();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'error',
      time: new Date().toISOString(),
    };
  }
}
