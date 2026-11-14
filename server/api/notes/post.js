import { randomUUID } from "node:crypto";
import { body, fail, json } from "../http.js";

export default async function post(req, res, context) {
  const data = await body(req, ["title", "body"]);
  const title = data.title ?? "";
  const text = data.body ?? "";
  if (typeof title !== "string" || [...title.trim()].length > 120) {
    fail(400, "标题最多 120 字符");
  }
  if (typeof text !== "string" || Buffer.byteLength(text) > 128 * 1024) {
    fail(400, "正文必须是字符串且不能超过 128 KiB");
  }
  const now = Date.now();
  const note = {
    id: randomUUID(),
    title: title.trim(),
    body: text,
    created_at: now,
    updated_at: now,
  };
  context.db
    .prepare("INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(note.id, note.title, note.body, note.created_at, note.updated_at);
  return json(res, 201, note);
}
