import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ddl = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  total_cost_nanos INTEGER NOT NULL DEFAULT 0,
  unpriced_requests INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  parent_task_id TEXT,
  call_id TEXT,
  task TEXT,
  model TEXT,
  protocol TEXT,
  status TEXT,
  result TEXT,
  error TEXT,
  worker_pid INTEGER,
  total_cost_nanos INTEGER NOT NULL DEFAULT 0,
  unpriced_requests INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  completed_at INTEGER,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id, created_at);
CREATE TABLE IF NOT EXISTS shell_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  task_id TEXT,
  call_id TEXT,
  command TEXT,
  workdir TEXT,
  status TEXT,
  output TEXT,
  truncated INTEGER,
  stdin_closed INTEGER,
  exit_code INTEGER,
  error TEXT,
  worker_pid INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shell_jobs_session ON shell_jobs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shell_jobs_task ON shell_jobs(task_id);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT,
  body TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  task_id TEXT,
  item TEXT,
  meta TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, id);
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  task_id TEXT,
  through_id INTEGER,
  summary TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id, id);
CREATE INDEX IF NOT EXISTS idx_compactions_task ON compactions(task_id, id);
CREATE TABLE IF NOT EXISTS metering (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  task_id TEXT,
  message_id INTEGER,
  compaction_id INTEGER,
  measurement TEXT,
  created_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metering_message ON metering(message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metering_compaction ON metering(compaction_id);
CREATE INDEX IF NOT EXISTS idx_metering_session ON metering(session_id);
CREATE INDEX IF NOT EXISTS idx_metering_task ON metering(task_id);
`;

// 服务启动时打开数据库并初始化表。
export default function openDB(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    db.exec(ddl);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
