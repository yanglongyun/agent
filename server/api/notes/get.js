import { json } from "../http.js";

// 列表只带标题和正文开头，正文完整内容由详情接口读取。
export default function get(req, res, context) {
  const rows = context.db
    .prepare("SELECT id, title, body, created_at, updated_at FROM notes ORDER BY updated_at DESC")
    .all();
  const notes = rows.map((row) => ({
    id: row.id,
    title: row.title,
    preview: row.body.replace(/\s+/g, " ").trim().slice(0, 80),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  return json(res, 200, { notes });
}
