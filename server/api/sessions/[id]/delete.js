import fs from "node:fs/promises";
import path from "node:path";
import { removeAttachment } from "../../../attachments.js";
import { json, fail } from "../../http.js";

export default async function remove(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }
  if (Boolean(context.replies.get(id)?.running)) {
    fail(409, "会话正在回复，请先停止");
  }
  await context.tasks.cancelChildren({ sessionId: id });
  await context.tasks.shell.cancelScope({ sessionId: id });
  const db = context.db;
  // 用户上传和工具图片都属于当前会话；删除记录前先取出文件名。
  const images = db
    .prepare(
      `
    SELECT DISTINCT json_extract(part.value, '$.image_url') AS url
    FROM messages, json_each(CASE
      WHEN json_extract(messages.item, '$.type') = 'message' THEN json_extract(messages.item, '$.content')
      WHEN json_type(messages.item, '$.output') = 'array' THEN json_extract(messages.item, '$.output')
      ELSE '[]' END) AS part
    WHERE (messages.session_id = ? OR messages.task_id IN (SELECT id FROM tasks WHERE session_id = ?)) AND json_extract(part.value, '$.type') = 'input_image'
  `,
    )
    .all(id, id);
  const attachments = db
    .prepare(
      `
    SELECT DISTINCT json_extract(file.value, '$.url') AS url
    FROM messages, json_each(messages.meta, '$.attachments') AS file
    WHERE messages.session_id = ? OR messages.task_id IN (SELECT id FROM tasks WHERE session_id = ?)
  `,
    )
    .all(id, id);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "DELETE FROM metering WHERE session_id = ? OR task_id IN (SELECT id FROM tasks WHERE session_id = ?)",
    ).run(id, id);
    db.prepare(
      "DELETE FROM messages WHERE session_id = ? OR task_id IN (SELECT id FROM tasks WHERE session_id = ?)",
    ).run(id, id);
    db.prepare(
      "DELETE FROM compactions WHERE session_id = ? OR task_id IN (SELECT id FROM tasks WHERE session_id = ?)",
    ).run(id, id);
    db.prepare("DELETE FROM shell_jobs WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM tasks WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  context.replies.delete(id);
  context.events.publish({ deleted_session_id: id });
  for (const image of images) {
    await fs.rm(path.join(context.paths.images, path.basename(image.url)), { force: true });
  }
  for (const file of attachments) {
    await removeAttachment(context.paths.attachments, file.url);
  }
  return json(res, 200, { deleted: id });
}
