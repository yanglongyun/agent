import fs from "node:fs/promises";
import path from "node:path";
import { body, json, fail } from "../../../http.js";
import { createSession, messagePreview } from "../../../../session.js";
import { readImage, saveImage } from "../../../../images.js";
import { readAttachment, saveAttachment, removeAttachment } from "../../../../attachments.js";

export default async function post(req, res, context, id) {
  const { message_id } = await body(req, ["message_id"], 4096);
  if (!Number.isSafeInteger(message_id) || message_id <= 0) {
    fail(400, "请选择已保存的 AI 回答");
  }
  const db = context.db;
  const source = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!source) {
    fail(404, "会话不存在");
  }
  const rows = db
    .prepare(
      "SELECT id, item, meta, created_at FROM messages WHERE session_id = ? AND id <= ? ORDER BY id",
    )
    .all(id, message_id);
  const last = rows.at(-1);
  if (last?.id !== message_id) {
    fail(404, "回答不存在或不属于当前会话");
  }
  const answer = JSON.parse(last.item);
  if (answer.type !== "message" || answer.role !== "assistant") {
    fail(400, "只能从 AI 回答创建分支");
  }
  const pending = new Set();
  const messages = rows.map((row) => {
    const item = JSON.parse(row.item);
    if (item.type === "function_call") {
      pending.add(item.call_id);
    } else if (item.type === "function_call_output") {
      if (!pending.delete(item.call_id)) {
        fail(409, "对话的工具记录不完整，无法创建分支");
      }
    }
    return { ...row, item, meta: row.meta ? JSON.parse(row.meta) : {} };
  });
  if (pending.size) {
    fail(409, "该回答之前的工具调用尚未完成，无法创建分支");
  }
  const summaries = db
    .prepare(
      "SELECT through_id, summary, created_at FROM compactions WHERE session_id = ? AND through_id <= ? AND created_at <= ? ORDER BY id",
    )
    .all(id, message_id, last.created_at);
  const images = new Map();
  const attachments = new Map();
  let committed = false;
  try {
    for (const row of messages) {
      const parts = row.item.type === "function_call_output" ? row.item.output : row.item.content;
      if (!Array.isArray(parts)) {
        continue;
      }
      for (const part of parts) {
        if (part.type !== "input_image" || !part.image_url?.startsWith("/api/images/")) {
          continue;
        }
        const original = part.image_url;
        if (!images.has(original)) {
          const image = await readImage(
            context.paths.images,
            original.slice("/api/images/".length),
          );
          const copied = await saveImage(context.paths.images, image.bytes, path.extname(original));
          images.set(original, copied);
        }
        part.image_url = images.get(original);
      }
    }
    for (const row of messages) {
      for (const file of row.meta.attachments || []) {
        if (!attachments.has(file.url)) {
          const original = await readAttachment(context.paths.attachments, file.url);
          const copied = await saveAttachment(
            context.paths.attachments,
            original.name,
            file.type,
            original.bytes,
          );
          attachments.set(file.url, copied);
        }
        Object.assign(file, attachments.get(file.url));
      }
    }
    db.exec("BEGIN IMMEDIATE");
    let session;
    try {
      if (
        !db.prepare("SELECT id FROM messages WHERE session_id = ? AND id = ?").get(id, message_id)
      ) {
        fail(404, "原对话已被删除，无法创建分支");
      }
      const title = source.title || messagePreview(messages[0].item, messages[0].meta) || "对话";
      let number = 2;
      let name;
      do {
        const suffix = `（${number}）`;
        name = [...title].slice(0, 120 - [...suffix].length).join("") + suffix;
        number++;
      } while (db.prepare("SELECT id FROM sessions WHERE title = ? LIMIT 1").get(name));
      session = createSession(db, name);
      const ids = new Map();
      const insert = db.prepare(
        "INSERT INTO messages (session_id, item, meta, created_at) VALUES (?, ?, ?, ?)",
      );
      for (const row of messages) {
        const saved = insert.run(
          session.id,
          JSON.stringify(row.item),
          JSON.stringify({ ...row.meta, inherited: true }),
          row.created_at,
        );
        ids.set(row.id, Number(saved.lastInsertRowid));
      }
      const insertSummary = db.prepare(
        "INSERT INTO compactions (session_id, through_id, summary, created_at) VALUES (?, ?, ?, ?)",
      );
      for (const summary of summaries) {
        const throughId = ids.get(summary.through_id);
        if (!throughId) {
          throw new Error("压缩摘要的消息边界不存在");
        }
        insertSummary.run(session.id, throughId, summary.summary, summary.created_at);
      }
      db.exec("COMMIT");
      committed = true;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const entry = {
      ...session,
      preview: messagePreview(messages[0].item, messages[0].meta),
      running: false,
    };
    context.events.publish({ session: entry });
    return json(res, 201, entry);
  } finally {
    if (!committed) {
      await Promise.allSettled([
        ...[...images.values()].map((url) =>
          fs.rm(path.join(context.paths.images, path.basename(url)), { force: true }),
        ),
        ...[...attachments.values()].map((file) =>
          removeAttachment(context.paths.attachments, file.url),
        ),
      ]);
    }
  }
}
