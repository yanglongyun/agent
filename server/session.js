import { randomUUID } from "node:crypto";
import { message } from "./ai/index.js";

export function messagePreview(item) {
  const content = Array.isArray(item.content) ? item.content : [];
  const text = content
    .map((part) => part.text || "")
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, 60);
  return text || (content.some((part) => part.type === "input_image") ? "[图片]" : "");
}

export function createSession(db, title = "") {
  const now = Date.now();
  const session = {
    id: randomUUID(),
    title,
    created_at: now,
    updated_at: now,
  };
  db.prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    session.id,
    session.title,
    session.created_at,
    session.updated_at,
  );
  return session;
}

export function saveUserMessage(db, sessionId, item, createdAt = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const saved = db
      .prepare("INSERT INTO messages (session_id, item, created_at) VALUES (?, ?, ?)")
      .run(sessionId, JSON.stringify(item), createdAt);
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(createdAt, sessionId);
    db.exec("COMMIT");
    return { id: Number(saved.lastInsertRowid), item, usage: null, created_at: createdAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadContext(db, sessionId) {
  const previousResponse = db
    .prepare(
      `
      SELECT usage FROM messages
      WHERE session_id = ? AND (
        json_extract(item, '$.role') = 'assistant'
        OR json_extract(item, '$.type') IN ('function_call', 'reasoning')
      )
      ORDER BY id DESC LIMIT 1
    `,
    )
    .get(sessionId);
  const usage = previousResponse?.usage ? JSON.parse(previousResponse.usage) : null;
  const latest = db
    .prepare("SELECT * FROM compactions WHERE session_id = ? ORDER BY id DESC LIMIT 1")
    .get(sessionId);
  const stored = db
    .prepare("SELECT id, item FROM messages WHERE session_id = ? AND id > ? ORDER BY id")
    .all(sessionId, latest?.through_id || 0);
  const messages = stored.map((row) => JSON.parse(row.item));
  const messageIds = stored.map((row) => row.id);
  if (latest) {
    messages.unshift(message(latest.summary));
    messageIds.unshift(latest.through_id);
  }
  return { messages, messageIds, usage, latest };
}

function saveRound(db, sessionId, pending) {
  const savedMessages = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of pending) {
      const usage = row.usage === null ? null : JSON.stringify(row.usage);
      const saved = db
        .prepare("INSERT INTO messages (session_id, item, usage, created_at) VALUES (?, ?, ?, ?)")
        .run(sessionId, JSON.stringify(row.item), usage, row.created_at);
      savedMessages.push({
        sequence: row.sequence,
        id: Number(saved.lastInsertRowid),
        usage: row.usage,
        created_at: row.created_at,
      });
    }
    const session = db
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ? RETURNING *")
      .get(pending.at(-1).created_at, sessionId);
    db.exec("COMMIT");
    return { savedMessages, session };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createRunRecorder(db, sessionId, messageIds, preview, startSequence = 0) {
  const pending = [];
  let remainingCalls = 0;
  let receivedUsage = false;
  let sequence = startSequence;

  return {
    track(event) {
      const record = {};
      if (event.type === "compact" && event.status === "completed") {
        const throughId = messageIds[event.end - 1];
        if (event.start !== 0 || !throughId) {
          throw new Error("压缩边界无效");
        }
        const summary = event.item.content[0].text;
        const usage = event.usage ? JSON.stringify(event.usage) : null;
        record.compaction = db
          .prepare(
            "INSERT INTO compactions (session_id, through_id, summary, usage, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
          )
          .get(sessionId, throughId, summary, usage, Date.now());
        messageIds.splice(event.start, event.end - event.start, throughId);
        return record;
      }
      if (["message", "reasoning", "function_call", "function_call_output"].includes(event.type)) {
        if (!event.item) {
          return record;
        }
        record.sequence = sequence++;
        record.created_at = Date.now();
        pending.push({
          sequence: record.sequence,
          item: event.item,
          usage: null,
          created_at: record.created_at,
        });
        if (event.type === "function_call") {
          remainingCalls++;
        } else if (event.type === "function_call_output") {
          remainingCalls--;
        }
      } else if (event.type === "usage") {
        receivedUsage = true;
        if (pending.length > 0) {
          pending[pending.length - 1].usage = event.usage;
        }
      }
      if (receivedUsage && remainingCalls === 0 && pending.length > 0) {
        const saved = saveRound(db, sessionId, pending);
        record.saved = saved.savedMessages;
        record.savedItems = pending.map((row) => row.item);
        record.session = { ...saved.session, preview, running: true };
        messageIds.push(...saved.savedMessages.map((row) => row.id));
        pending.length = 0;
        receivedUsage = false;
      }
      return record;
    },
  };
}
