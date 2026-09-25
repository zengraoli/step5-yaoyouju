import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { APP_DDL, IDENTITY_DDL } from './schema';
import { runSeed, seedIfEmpty } from './seed';
import { FieldCrypto } from './crypto.service';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yaoyouju-test-'));
}

function setup(dir: string) {
  const app = new DatabaseSync(path.join(dir, 'app.db'));
  const identity = new DatabaseSync(path.join(dir, 'identity.db'));
  app.exec(APP_DDL);
  identity.exec(IDENTITY_DDL);
  return { app, identity };
}

describe('T02 数据模型与种子数据', () => {
  it('建表覆盖 ER 全部实体', () => {
    const dir = tmpDir();
    const { app, identity } = setup(dir);
    const tables = (
      app.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of [
      'users', 'consent', 'episode', 'care_event', 'report', 'symptom_log', 'analysis',
      'analysis_citation', 'followup_summary', 'feedback', 'safety_event', 'evidence_doc',
      'evidence_chunk', 'content_item', 'content_version', 'review_record', 'role', 'admin_user',
      'audit_log', 'model_release', 'eval_set', 'eval_run', 'feature_switch', 'case_submission',
      'analysis_task', 'qa_session', 'qa_message',
    ]) {
      expect(tables).toContain(t);
    }
    const idTables = (
      identity.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(idTables).toContain('identity_profile');
    app.close();
    identity.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('种子数据写入且幂等（重复启动不重复写入）', () => {
    const dir = tmpDir();
    const { app, identity } = setup(dir);
    const crypto = FieldCrypto.fromEnv(dir);
    expect(seedIfEmpty(app, identity, crypto)).toBe(true);
    expect(seedIfEmpty(app, identity, crypto)).toBe(false);

    const count = (sql: string) => (app.prepare(sql).get() as { n: number }).n;
    expect(count('SELECT COUNT(*) n FROM users')).toBe(2);
    expect(count('SELECT COUNT(*) n FROM episode')).toBe(2);
    expect(count('SELECT COUNT(*) n FROM care_event')).toBe(7);
    expect(count('SELECT COUNT(*) n FROM report')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM analysis')).toBe(2);
    expect(count('SELECT COUNT(*) n FROM content_item')).toBe(10);
    expect(count('SELECT COUNT(*) n FROM content_version')).toBeGreaterThanOrEqual(10);
    expect(count('SELECT COUNT(*) n FROM evidence_doc')).toBe(6);
    expect(count('SELECT COUNT(*) n FROM evidence_chunk')).toBeGreaterThanOrEqual(12);
    expect(count('SELECT COUNT(*) n FROM role')).toBe(5);
    expect(count('SELECT COUNT(*) n FROM admin_user')).toBe(5);
    expect(count('SELECT COUNT(*) n FROM feature_switch')).toBe(3);
    expect(count('SELECT COUNT(*) n FROM eval_set')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM safety_event')).toBe(1);

    // 每个演示用户都带病程、报告/事件与分析
    const users = app.prepare('SELECT id FROM users').all() as { id: string }[];
    for (const u of users) {
      const eps = app.prepare('SELECT COUNT(*) n FROM episode WHERE user_id=?').get(u.id) as { n: number };
      expect(eps.n).toBeGreaterThanOrEqual(1);
      const ans = app
        .prepare('SELECT COUNT(*) n FROM analysis a JOIN episode e ON e.id=a.episode_id WHERE e.user_id=?')
        .get(u.id) as { n: number };
      expect(ans.n).toBeGreaterThanOrEqual(1);
    }
    app.close();
    identity.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('身份库中手机号与姓名为密文，可正确解密；手机号脱敏', () => {
    const dir = tmpDir();
    const { app, identity } = setup(dir);
    runSeed(app, identity, FieldCrypto.fromEnv(dir));
    const crypto = FieldCrypto.fromEnv(dir);
    const rows = identity.prepare('SELECT phone_enc, real_name_enc FROM identity_profile').all() as {
      phone_enc: string;
      real_name_enc: string;
    }[];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      // 密文不等于明文，且带版本前缀
      expect(r.phone_enc.startsWith('v1.')).toBe(true);
      expect(r.phone_enc).not.toMatch(/^\d{11}$/);
      expect(crypto.decrypt(r.phone_enc)).toMatch(/^\d{11}$/);
      const name = crypto.decrypt(r.real_name_enc);
      expect(name.length).toBeGreaterThan(1);
      expect(name).not.toBe(r.real_name_enc);
    }
    expect(FieldCrypto.maskPhone('13800001234')).toBe('138****1234');
    app.close();
    identity.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
