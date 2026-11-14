import { body, fail, json } from "../../http.js";

export default async function put(req, res, context, id) {
  const data = await body(req, ["title", "body"]);
  if (!("title" in data) && !("body" in data)) {
    fail(400, "没有可保存的字段");
  }
  if ("title" in data && (typeof data.title !== "string" || [...data.title.trim()].length > 120)) {
    fail(400, "标题最多 120 字符");
  }
  if (
    "body" in data &&
    (typeof data.body !== "string" || Buffer.byteLength(data.body) > 128 * 1024)
  ) {
    fail(400, "正文必须是字符串且不能超过 128 KiB");
  }
  const db = context.db;
  const current = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
  if (!current) {
    fail(404, "笔记不存在");
  }
  const note = {
    id,
    title: "title" in data ? data.title.trim() : current.title,
    body: "body" in data ? data.body : current.body,
    created_at: current.created_at,
    updated_at: Date.now(),
  };
  db.prepare("UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?").run(
    note.title,
    note.body,
    note.updated_at,
    id,
  );
  return json(res, 200, note);
}
