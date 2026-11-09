import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ddl = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  item TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  through_id INTEGER,
  summary TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id, id);
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
