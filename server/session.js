import { randomUUID } from "node:crypto";
import { message } from "./ai/index.js";
import { captureEnvironment, appendEnvironment } from "./environment.js";
import { appendAttachments } from "./attachments.js";
import { withCost } from "./metering/index.js";

export function messagePreview(item, meta) {
  const content = Array.isArray(item.content) ? item.content : [];
  const first = content[0];
  if (first?.type === "input_image") {
    return "[图片]";
  }
  const text = first?.text || meta?.attachments?.map((file) => file.name).join("、") || "";
  return text.replace(/\s+/g, " ").slice(0, 60);
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
  return withCost(db.prepare("SELECT * FROM sessions WHERE id = ?").get(session.id));
}

// 调用方持有消息或摘要事务；明细与累计金额必须一同提交或回滚。
function saveMetering(db, owner, measurement, messageId, compactionId, createdAt) {
  const amount = measurement.cost ? Math.round(measurement.cost.amount * 1e9) : 0;
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    (measurement.cost && measurement.cost.currency !== "USD")
  ) {
    throw new Error("计费金额无效");
  }
  db.prepare(
    "INSERT INTO metering (session_id, task_id, message_id, compaction_id, measurement, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    owner.sessionId ?? null,
    owner.taskId ?? null,
    messageId,
    compactionId,
    JSON.stringify(measurement),
    createdAt,
  );
  const unpriced = measurement.cost ? 0 : 1;
  let sessionId = owner.sessionId;
  if (owner.taskId) {
    const task = db
      .prepare(
        "UPDATE tasks SET total_cost_nanos = total_cost_nanos + ?, unpriced_requests = unpriced_requests + ?, request_count = request_count + 1 WHERE id = ? RETURNING session_id",
      )
      .get(amount, unpriced, owner.taskId);
    if (!task) {
      throw new Error("计费任务不存在");
    }
    sessionId = task.session_id;
  }
  const updated = db
    .prepare(
      "UPDATE sessions SET total_cost_nanos = total_cost_nanos + ?, unpriced_requests = unpriced_requests + ?, request_count = request_count + 1 WHERE id = ?",
    )
    .run(amount, unpriced, sessionId);
  if (updated.changes !== 1) {
    throw new Error("计费会话不存在");
  }
}

function ownerField(owner) {
  if (Boolean(owner.sessionId) === Boolean(owner.taskId)) {
    throw new Error("消息必须且只能归属一个会话或任务");
  }
  return owner.taskId ? "task_id" : "session_id";
}

function touchOwner(db, owner, time) {
  if (owner.taskId) {
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(time, owner.taskId);
    return null;
  }
  const session = db
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ? RETURNING *")
    .get(time, owner.sessionId);
  return withCost(session);
}

export function saveUserMessage(
  db,
  owner,
  item,
  workdir,
  createdAt = Date.now(),
  attachments = [],
  modelId,
  compactModelId,
) {
  ownerField(owner);
  const meta = { environment: captureEnvironment(workdir, createdAt) };
  if (modelId !== undefined) {
    meta.model_id = modelId;
  }
  if (compactModelId !== undefined) {
    meta.compact_model_id = compactModelId;
  }
  if (attachments.length) {
    meta.attachments = attachments.map((file) => ({ ...file }));
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const saved = db
      .prepare(
        "INSERT INTO messages (session_id, task_id, item, meta, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        owner.sessionId ?? null,
        owner.taskId ?? null,
        JSON.stringify(item),
        JSON.stringify(meta),
        createdAt,
      );
    touchOwner(db, owner, createdAt);
    db.exec("COMMIT");
    return { id: Number(saved.lastInsertRowid), item, meta, usage: null, created_at: createdAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadContext(db, owner) {
  const field = ownerField(owner);
  const ownerId = owner.sessionId || owner.taskId;
  const previousResponse = db
    .prepare(
      `
      SELECT messages.usage, messages.created_at, metering.measurement FROM messages
      LEFT JOIN metering ON metering.message_id = messages.id
      WHERE messages.${field} = ? AND (
        json_extract(item, '$.role') = 'assistant'
        OR json_extract(item, '$.type') IN ('function_call', 'reasoning')
      )
      AND COALESCE(json_extract(messages.meta, '$.inherited'), 0) = 0
      ORDER BY messages.id DESC LIMIT 1
    `,
    )
    .get(ownerId);
  const usage = previousResponse?.usage ? JSON.parse(previousResponse.usage) : null;
  const metering = previousResponse?.measurement ? JSON.parse(previousResponse.measurement) : null;
  const latest = db
    .prepare(`SELECT * FROM compactions WHERE ${field} = ? ORDER BY id DESC LIMIT 1`)
    .get(ownerId);
  const stored = db
    .prepare(`SELECT id, item, meta FROM messages WHERE ${field} = ? AND id > ? ORDER BY id`)
    .all(ownerId, latest?.through_id || 0);
  const messages = stored.map((row) => {
    const item = JSON.parse(row.item);
    const meta = row.meta ? JSON.parse(row.meta) : null;
    if (item.type === "message" && item.role === "user" && meta?.attachments?.length) {
      appendAttachments(item, meta.attachments);
    }
    if (item.type === "message" && item.role === "user" && meta?.environment) {
      appendEnvironment(item, meta.environment);
    }
    return item;
  });
  const messageIds = stored.map((row) => row.id);
  if (latest) {
    messages.unshift(message(latest.summary));
    messageIds.unshift(latest.through_id);
  }
  // 摘要已保存但主请求失败时，不再用摘要之前的响应重复触发压缩。
  const afterCompaction = !latest || previousResponse?.created_at >= latest.created_at;
  return {
    messages,
    records: stored,
    messageIds,
    usage: afterCompaction ? usage : null,
    metering: afterCompaction ? metering : null,
    lastResponseAt: afterCompaction ? (previousResponse?.created_at ?? null) : null,
    latest,
  };
}

function saveRound(db, owner, pending) {
  const savedMessages = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of pending) {
      const usage = row.usage === null ? null : JSON.stringify(row.usage);
      const saved = db
        .prepare(
          "INSERT INTO messages (session_id, task_id, item, meta, usage, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          owner.sessionId ?? null,
          owner.taskId ?? null,
          JSON.stringify(row.item),
          row.meta ? JSON.stringify(row.meta) : null,
          usage,
          row.created_at,
        );
      if (row.metering) {
        saveMetering(db, owner, row.metering, Number(saved.lastInsertRowid), null, row.created_at);
      }
      savedMessages.push({
        sequence: row.sequence,
        id: Number(saved.lastInsertRowid),
        meta: row.meta ?? null,
        usage: row.usage,
        metering: row.metering,
        created_at: row.created_at,
      });
    }
    for (const row of pending) {
      if (row.meta?.task_results) {
        let sessionId = owner.sessionId;
        if (owner.taskId) {
          sessionId = db
            .prepare("SELECT session_id FROM tasks WHERE id = ?")
            .get(owner.taskId).session_id;
        }
        for (const id of row.meta.task_results) {
          db.prepare(
            "UPDATE tasks SET delivered_at = ? WHERE id = ? AND session_id = ? AND parent_task_id IS ?",
          ).run(row.created_at, id, sessionId, owner.taskId ?? null);
        }
      }
    }
    const session = touchOwner(db, owner, pending.at(-1).created_at);
    db.exec("COMMIT");
    return { savedMessages, session };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createRunRecorder(db, owner, messageIds, preview, startSequence = 0) {
  ownerField(owner);
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
        db.exec("BEGIN IMMEDIATE");
        try {
          record.compaction = db
            .prepare(
              "INSERT INTO compactions (session_id, task_id, through_id, summary, usage, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
            )
            .get(
              owner.sessionId ?? null,
              owner.taskId ?? null,
              throughId,
              summary,
              usage,
              Date.now(),
            );
          if (event.metering) {
            saveMetering(
              db,
              owner,
              event.metering,
              null,
              record.compaction.id,
              record.compaction.created_at,
            );
          }
          const session = touchOwner(db, owner, record.compaction.created_at);
          if (session) {
            record.session = { ...session, preview, running: true };
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        record.compaction = { ...record.compaction, usage: event.usage, metering: event.metering };
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
          meta: event.meta ?? null,
          usage: null,
          metering: null,
          created_at: record.created_at,
        });
        if (event.type === "message" && event.item.role === "user" && event.meta?.task_results) {
          const saved = saveRound(db, owner, pending);
          record.saved = saved.savedMessages;
          if (saved.session) {
            record.session = { ...saved.session, preview, running: true };
          }
          messageIds.push(...saved.savedMessages.map((row) => row.id));
          pending.length = 0;
          return record;
        }
        if (event.type === "function_call") {
          remainingCalls++;
        } else if (event.type === "function_call_output") {
          remainingCalls--;
        }
      } else if (event.type === "usage") {
        if (pending.length > 0) {
          receivedUsage = true;
          pending[pending.length - 1].usage = event.usage;
          pending[pending.length - 1].metering = event.metering;
        }
      }
      if (receivedUsage && remainingCalls === 0 && pending.length > 0) {
        const saved = saveRound(db, owner, pending);
        record.saved = saved.savedMessages;
        record.savedItems = pending.map((row) => row.item);
        if (saved.session) {
          record.session = { ...saved.session, preview, running: true };
        }
        messageIds.push(...saved.savedMessages.map((row) => row.id));
        pending.length = 0;
        receivedUsage = false;
      }
      return record;
    },
  };
}

// 分叉只复制已提交的完整上下文，不复制 usage 或计量，避免重复计费。
export function forkContext(db, from, to) {
  ownerField(to);
  const context = loadContext(db, from);
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare(
      "INSERT INTO messages (session_id, task_id, item, meta, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    if (context.latest) {
      insert.run(
        to.sessionId ?? null,
        to.taskId ?? null,
        JSON.stringify(message(context.latest.summary)),
        JSON.stringify({ inherited: true }),
        Date.now(),
      );
    }
    for (const row of context.records) {
      const meta = row.meta ? JSON.parse(row.meta) : {};
      meta.inherited = true;
      insert.run(
        to.sessionId ?? null,
        to.taskId ?? null,
        row.item,
        JSON.stringify(meta),
        Date.now(),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
