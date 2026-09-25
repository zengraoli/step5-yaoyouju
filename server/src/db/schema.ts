/**
 * 数据库结构（按 docs/system-design.md 第 3 节 ER 建表）
 * - APP_DDL：业务库 server/data/app.db
 * - IDENTITY_DDL：身份隔离库 server/data/identity.db（手机号 / 姓名字段加密）
 * 时间一律 UTC ISO8601 字符串；JSON 字段存 TEXT。
 */

export const IDENTITY_DDL = `
CREATE TABLE IF NOT EXISTS identity_profile (
  user_id       TEXT PRIMARY KEY,
  phone_enc     TEXT NOT NULL,
  phone_hash    TEXT NOT NULL UNIQUE,
  real_name_enc TEXT
);
`;

export const APP_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL,
  retention_until TEXT
);

CREATE TABLE IF NOT EXISTS consent (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  scope      TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS episode (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  onset_date      TEXT,
  onset_certainty TEXT NOT NULL DEFAULT '尚未确认',
  status          TEXT NOT NULL DEFAULT '进行中',
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_event (
  id            TEXT PRIMARY KEY,
  episode_id    TEXT NOT NULL REFERENCES episode(id),
  event_type    TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  reported_at   TEXT NOT NULL,
  source_type   TEXT NOT NULL,
  raw_text      TEXT,
  verify_status TEXT NOT NULL DEFAULT '尚未确认',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS report (
  id              TEXT PRIMARY KEY,
  care_event_id   TEXT NOT NULL REFERENCES care_event(id),
  report_date     TEXT,
  raw_text        TEXT,
  extracted_terms TEXT,
  oss_key         TEXT
);

CREATE TABLE IF NOT EXISTS symptom_log (
  id                  TEXT PRIMARY KEY,
  care_event_id      TEXT NOT NULL REFERENCES care_event(id),
  sit_minutes         INTEGER,
  planned_activity_done TEXT,
  sleep_impact        INTEGER,
  top_worry           TEXT,
  leg_change          TEXT NOT NULL DEFAULT '尚未确认'
);

CREATE TABLE IF NOT EXISTS analysis (
  id                  TEXT PRIMARY KEY,
  episode_id          TEXT NOT NULL REFERENCES episode(id),
  version             INTEGER NOT NULL DEFAULT 1,
  model_release_id    TEXT,
  sections            TEXT,
  retrieval_snapshot  TEXT,
  safety_flag         TEXT NOT NULL DEFAULT 'none',
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_citation (
  id             TEXT PRIMARY KEY,
  analysis_id    TEXT NOT NULL REFERENCES analysis(id),
  evidence_doc_id TEXT NOT NULL,
  statement      TEXT NOT NULL,
  supported      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS followup_summary (
  id            TEXT PRIMARY KEY,
  episode_id    TEXT NOT NULL REFERENCES episode(id),
  content       TEXT,
  export_format TEXT,
  exported_at   TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id                TEXT PRIMARY KEY,
  user_id           TEXT,
  analysis_id       TEXT,
  content_item_id   TEXT,
  help_type         TEXT,
  unsolved_question TEXT,
  is_error_report   INTEGER NOT NULL DEFAULT 0,
  category          TEXT,
  description       TEXT,
  severity          TEXT,
  status            TEXT NOT NULL DEFAULT '待处理',
  report_meta       TEXT,
  raw_content       TEXT,
  authorized_by     TEXT,
  authorized_at     TEXT,
  authorize_scope   TEXT,
  created_at        TEXT NOT NULL
);

-- 举报处置处理记录（T12）：一条反馈可多次处置，记录只追加
CREATE TABLE IF NOT EXISTS feedback_handling (
  id          TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id),
  actor_id    TEXT,
  action      TEXT NOT NULL,
  comment     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS safety_event (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  rule_code    TEXT NOT NULL,
  severity     TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_doc (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  source_type   TEXT NOT NULL,
  source_url    TEXT,
  license       TEXT,
  verified_at   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  -- T11 切分入库管线：原文 + 状态（待切分 / 已切分 / 失败）+ 最近一次入库时间与错误信息
  raw_text      TEXT,
  ingest_status TEXT NOT NULL DEFAULT '待切分',
  ingested_at   TEXT,
  ingest_error  TEXT,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS evidence_chunk (
  id        TEXT PRIMARY KEY,
  doc_id    TEXT NOT NULL REFERENCES evidence_doc(id),
  content   TEXT NOT NULL,
  embedding TEXT,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS content_item (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  applicable_scope TEXT,
  not_applicable   TEXT,
  current_status   TEXT NOT NULL DEFAULT '草稿',
  offline_switch   INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_version (
  id                 TEXT PRIMARY KEY,
  item_id            TEXT NOT NULL REFERENCES content_item(id),
  version            INTEGER NOT NULL DEFAULT 1,
  script             TEXT,
  asset_key          TEXT,
  subtitle_text      TEXT,
  model_asset_version TEXT,
  published_at       TEXT
);

CREATE TABLE IF NOT EXISTS review_record (
  id           TEXT PRIMARY KEY,
  target_id    TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  reviewer_id  TEXT,
  decision     TEXT NOT NULL,
  review_scope TEXT,
  comment      TEXT,
  reviewed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  permissions TEXT
);

CREATE TABLE IF NOT EXISTS admin_user (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role_id     TEXT NOT NULL REFERENCES role(id),
  mfa_enabled INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  diff       TEXT,
  request_id TEXT,
  prev_hash  TEXT,
  hash       TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_release (
  id                  TEXT PRIMARY KEY,
  model_name          TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  retrieval_strategy  TEXT,
  content_lib_version TEXT,
  status              TEXT NOT NULL DEFAULT '灰度',
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_set (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  case_count   INTEGER NOT NULL DEFAULT 0,
  deidentified INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS eval_run (
  id               TEXT PRIMARY KEY,
  model_release_id TEXT NOT NULL REFERENCES model_release(id),
  eval_set_id      TEXT NOT NULL REFERENCES eval_set(id),
  metrics          TEXT,
  result           TEXT NOT NULL,
  trigger_reason   TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_switch (
  id       TEXT PRIMARY KEY,
  key      TEXT NOT NULL UNIQUE,
  enabled  INTEGER NOT NULL DEFAULT 0,
  reason   TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_submission (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  edited_content TEXT,
  consent_scope  TEXT,
  status         TEXT NOT NULL DEFAULT '待审',
  created_at     TEXT NOT NULL
);

-- 任务队列（演示实现替代 Redis Streams）：分析任务由 Worker 轮询消费
CREATE TABLE IF NOT EXISTS analysis_task (
  id                TEXT PRIMARY KEY,
  episode_id        TEXT NOT NULL REFERENCES episode(id),
  user_id           TEXT NOT NULL REFERENCES users(id),
  payload           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  attempts          INTEGER NOT NULL DEFAULT 0,
  safety_flag       TEXT,
  result_analysis_id TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- 问与解释会话（T08）
CREATE TABLE IF NOT EXISTS qa_session (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  episode_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_message (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES qa_session(id),
  role             TEXT NOT NULL,
  content          TEXT NOT NULL,
  citations        TEXT,
  refused          INTEGER NOT NULL DEFAULT 0,
  followup_question TEXT,
  created_at       TEXT NOT NULL
);
`;

/**
 * 既有数据库的列增量迁移（T12 反馈与举报）。
 * `CREATE TABLE IF NOT EXISTS` 不会给已存在的表补列，老库启动时按需 ALTER（幂等）。
 */
export function ensureFeedbackColumns(db: {
  exec(sql: string): unknown;
  prepare(sql: string): { all(...args: unknown[]): unknown };
}): void {
  const cols = db.prepare('PRAGMA table_info(feedback)').all() as { name: string }[];
  if (cols.length === 0) return; // 表尚未创建（新建库走 APP_DDL）
  const names = new Set(cols.map((c) => c.name));
  const additions: [string, string][] = [
    ['user_id', 'user_id TEXT'],
    ['content_item_id', 'content_item_id TEXT'],
    ['category', 'category TEXT'],
    ['description', 'description TEXT'],
    ['severity', 'severity TEXT'],
    ['status', "status TEXT NOT NULL DEFAULT '待处理'"],
    ['report_meta', 'report_meta TEXT'],
    ['raw_content', 'raw_content TEXT'],
    ['authorized_by', 'authorized_by TEXT'],
    ['authorized_at', 'authorized_at TEXT'],
    ['authorize_scope', 'authorize_scope TEXT'],
  ];
  for (const [name, ddl] of additions) {
    if (!names.has(name)) db.exec(`ALTER TABLE feedback ADD COLUMN ${ddl}`);
  }
}

/**
 * 既有数据库的列增量迁移（T11 证据入库管线字段）。
 * `CREATE TABLE IF NOT EXISTS` 不会给已存在的表补列，老库启动时按需 ALTER（幂等）。
 */
export function ensureEvidenceColumns(db: {
  exec(sql: string): unknown;
  prepare(sql: string): { all(...args: unknown[]): unknown };
}): void {
  const cols = db.prepare('PRAGMA table_info(evidence_doc)').all() as { name: string }[];
  if (cols.length === 0) return; // 表尚未创建（新建库走 APP_DDL）
  const names = new Set(cols.map((c) => c.name));
  const additions: [string, string][] = [
    ['raw_text', 'raw_text TEXT'],
    ['ingest_status', "ingest_status TEXT NOT NULL DEFAULT '待切分'"],
    ['ingested_at', 'ingested_at TEXT'],
    ['ingest_error', 'ingest_error TEXT'],
    ['updated_at', 'updated_at TEXT'],
  ];
  for (const [name, ddl] of additions) {
    if (!names.has(name)) db.exec(`ALTER TABLE evidence_doc ADD COLUMN ${ddl}`);
  }
}
