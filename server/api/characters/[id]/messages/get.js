import { fail, json } from "../../../http.js";

// 聊天记录分页：默认最近 50 条，before 传最早一条的 id 继续向前读。
export default function get(req, res, context, id) {
  if (!context.db.prepare("SELECT 1 FROM characters WHERE id = ?").get(id)) {
    fail(404, "角色不存在");
  }
  const url = new URL(req.url, "http://localhost");
  const before = Number(url.searchParams.get("before") || 0);
  let rows;
  if (before > 0) {
    rows = context.db
      .prepare(
        "SELECT * FROM character_messages WHERE character_id = ? AND id < ? ORDER BY id DESC LIMIT 50",
      )
      .all(id, before);
  } else {
    rows = context.db
      .prepare("SELECT * FROM character_messages WHERE character_id = ? ORDER BY id DESC LIMIT 50")
      .all(id);
  }
  return json(res, 200, { messages: rows.reverse(), has_more: rows.length === 50 });
}
