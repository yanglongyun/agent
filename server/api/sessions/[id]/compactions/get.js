import { json, fail } from "../../../http.js";

export default async function compactions(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }

  const compactions = context.db
    .prepare("SELECT * FROM compactions WHERE session_id = ? ORDER BY id")
    .all(id);
  return json(res, 200, { compactions });
}
