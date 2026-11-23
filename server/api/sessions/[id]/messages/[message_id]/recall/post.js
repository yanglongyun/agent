import fs from "node:fs/promises";
import path from "node:path";
import { readAttachment, removeAttachment } from "../../../../../../attachments.js";
import { readImage } from "../../../../../../images.js";
import { withCost } from "../../../../../../metering/index.js";
import { messagePreview } from "../../../../../../session.js";
import { body, fail, json } from "../../../../../http.js";

export default async function post(req, res, context, id, messageId) {
  const { last_message_id } = await body(req, ["last_message_id"], 4096);
  if (
    !Number.isSafeInteger(messageId) ||
    messageId <= 0 ||
    !Number.isSafeInteger(last_message_id) ||
    last_message_id < messageId
  ) {
    fail(400, "请选择已保存的用户消息");
  }
  const db = context.db;
  const row = db
    .prepare("SELECT item, meta, created_at FROM messages WHERE session_id = ? AND id = ?")
    .get(id, messageId);
  if (!row) {
    fail(404, "消息不存在");
  }
  const item = JSON.parse(row.item);
  const meta = JSON.parse(row.meta) || {};
  if (item.type !== "message" || item.role !== "user" || meta.task_results) {
    fail(400, "只能撤回用户发送的消息");
  }
  if (context.replies.get(id)?.running) {
    fail(409, "请先停止生成");
  }
  if (context.recalling.has(id)) {
    fail(409, "正在撤回消息");
  }
  const latest = db.prepare("SELECT MAX(id) AS id FROM messages WHERE session_id = ?").get(id);
  if (latest.id !== last_message_id) {
    fail(409, "对话已更新，请重新确认撤回");
  }

  context.recalling.add(id);
  try {
    let draft;
    try {
      draft = await restoreDraft(context.paths, item, meta);
    } catch (error) {
      if (error.code === "ENOENT") {
        fail(409, "这条消息的附件已不可用，无法撤回");
      }
      throw error;
    }
    const scope = { sessionId: id };
    await context.tasks.cancelChildren(scope);
    await context.tasks.shell.cancelScope(scope);
    const discardedTasks = JSON.stringify(
      db
        .prepare(
          `
      WITH RECURSIVE discarded(id) AS (
        SELECT tasks.id FROM tasks
        WHERE tasks.session_id = ? AND tasks.parent_task_id IS NULL AND COALESCE((
          SELECT messages.id FROM messages
          WHERE messages.session_id = tasks.session_id AND messages.created_at <= tasks.created_at
            AND json_extract(messages.item, '$.type') = 'function_call'
            AND json_extract(messages.item, '$.call_id') = tasks.call_id
            AND NOT COALESCE(json_extract(messages.meta, '$.inherited'), 0)
          ORDER BY messages.id DESC LIMIT 1
        ) >= ?, tasks.created_at >= ?)
        UNION ALL
        SELECT tasks.id FROM tasks JOIN discarded ON tasks.parent_task_id = discarded.id
      )
      SELECT id FROM discarded
    `,
        )
        .all(id, messageId, row.created_at)
        .map((task) => task.id),
    );
    const removed = db
      .prepare(
        `
      SELECT item, meta FROM messages
      WHERE (session_id = ? AND id >= ?) OR task_id IN (SELECT value FROM json_each(?))
    `,
      )
      .all(id, messageId, discardedTasks);
    const files = discardedFiles(removed);

    db.exec("BEGIN IMMEDIATE");
    let session;
    try {
      // 保留较早的任务。若其结果只在被撤回的历史交接，允许下一轮重新收取。
      db.prepare(
        `
        UPDATE tasks SET delivered_at = NULL
        WHERE session_id = ? AND parent_task_id IS NULL AND id IN (
          SELECT result.value FROM messages, json_each(messages.meta, '$.task_results') AS result
          WHERE messages.session_id = ? AND messages.id >= ?
        )
      `,
      ).run(id, id, messageId);
      db.prepare(
        `
        DELETE FROM metering WHERE task_id IN (SELECT value FROM json_each(?)) OR (
          session_id = ? AND (
            message_id >= ? OR compaction_id IN (
              SELECT id FROM compactions WHERE session_id = ? AND (through_id >= ? OR created_at > ?)
            )
          )
        )
      `,
      ).run(discardedTasks, id, messageId, id, messageId, row.created_at);
      db.prepare(
        `
        DELETE FROM shell_jobs WHERE session_id = ? AND (
          task_id IN (SELECT value FROM json_each(?)) OR (task_id IS NULL AND COALESCE((
            SELECT messages.id FROM messages
            WHERE messages.session_id = shell_jobs.session_id AND messages.created_at <= shell_jobs.created_at
              AND json_extract(messages.item, '$.type') = 'function_call'
              AND json_extract(messages.item, '$.call_id') = shell_jobs.call_id
              AND NOT COALESCE(json_extract(messages.meta, '$.inherited'), 0)
            ORDER BY messages.id DESC LIMIT 1
          ) >= ?, shell_jobs.created_at >= ?))
        )
      `,
      ).run(id, discardedTasks, messageId, row.created_at);
      db.prepare("DELETE FROM tasks WHERE id IN (SELECT value FROM json_each(?))").run(
        discardedTasks,
      );
      db.prepare(
        `
        DELETE FROM compactions WHERE task_id IN (SELECT value FROM json_each(?))
        OR (session_id = ? AND (through_id >= ? OR created_at > ?))
      `,
      ).run(discardedTasks, id, messageId, row.created_at);
      db.prepare(
        `
        DELETE FROM messages WHERE task_id IN (SELECT value FROM json_each(?))
        OR (session_id = ? AND id >= ?)
      `,
      ).run(discardedTasks, id, messageId);
      const counts = db
        .prepare(
          `
        SELECT COUNT(*) AS requests,
          COUNT(*) - COUNT(json_extract(measurement, '$.cost.amount')) AS unpriced,
          COALESCE(SUM(CAST(ROUND(json_extract(measurement, '$.cost.amount') * 1000000000) AS INTEGER)), 0) AS nanos
        FROM metering WHERE session_id = ? OR task_id IN (SELECT id FROM tasks WHERE session_id = ?)
      `,
        )
        .get(id, id);
      const saved = db
        .prepare(
          `
        UPDATE sessions SET total_cost_nanos = ?, unpriced_requests = ?, request_count = ?, updated_at = ?
        WHERE id = ? RETURNING *
      `,
        )
        .get(counts.nanos, counts.unpriced, counts.requests, Date.now(), id);
      const first = db
        .prepare("SELECT item, meta FROM messages WHERE session_id = ? ORDER BY id LIMIT 1")
        .get(id);
      session = {
        ...withCost(saved),
        preview: first ? messagePreview(JSON.parse(first.item), JSON.parse(first.meta)) : "",
        running: false,
      };
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    context.replies.delete(id);
    context.events.publish({ session, recalled_from: messageId });
    const cursor = context.events.cursor;
    await removeUnusedFiles(db, context.paths, files);
    return json(res, 200, {
      draft,
      session,
      cursor,
    });
  } finally {
    context.recalling.delete(id);
  }
}

async function restoreDraft(paths, item, meta) {
  const parts = item.content || [];
  const attachments = [];
  for (const part of parts) {
    if (part.type === "input_image") {
      const name = path.basename(part.image_url);
      const { bytes, type } = await readImage(paths.images, name);
      attachments.push({
        name,
        type,
        size: bytes.length,
        data: `data:${type};base64,${bytes.toString("base64")}`,
      });
    }
  }
  for (const file of meta.attachments || []) {
    const { name, bytes } = await readAttachment(paths.attachments, file.url);
    attachments.push({
      name,
      type: file.type,
      size: bytes.length,
      data: `data:${file.type};base64,${bytes.toString("base64")}`,
    });
  }
  const text = parts
    .filter((part) => part.type === "input_text")
    .map((part) => part.text)
    .join("\n");
  return { text, attachments };
}

function discardedFiles(rows) {
  const images = new Set();
  const attachments = new Set();
  for (const row of rows) {
    const item = JSON.parse(row.item);
    const parts = item.type === "function_call_output" ? item.output : item.content;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.type === "input_image" && part.image_url.startsWith("/api/images/")) {
          images.add(part.image_url);
        }
      }
    }
    for (const file of JSON.parse(row.meta)?.attachments || []) {
      attachments.add(file.url);
    }
  }
  return { images, attachments };
}

async function removeUnusedFiles(db, paths, files) {
  // 子任务可继承附件与图片。只有所有引用都消失才清理文件。
  const hasImage = db.prepare(`
    SELECT 1 FROM messages, json_each(CASE
      WHEN json_extract(item, '$.type') = 'message' THEN json_extract(item, '$.content')
      WHEN json_type(item, '$.output') = 'array' THEN json_extract(item, '$.output')
    END) AS part WHERE json_extract(part.value, '$.image_url') = ? LIMIT 1
  `);
  const hasAttachment = db.prepare(`
    SELECT 1 FROM messages, json_each(meta, '$.attachments') AS file
    WHERE json_extract(file.value, '$.url') = ? LIMIT 1
  `);
  const removals = [];
  for (const image of files.images) {
    if (!hasImage.get(image)) {
      removals.push(fs.rm(path.join(paths.images, path.basename(image)), { force: true }));
    }
  }
  for (const file of files.attachments) {
    if (!hasAttachment.get(file)) {
      removals.push(removeAttachment(paths.attachments, file));
    }
  }
  await Promise.allSettled(removals);
}
