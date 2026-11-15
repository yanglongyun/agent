import { json } from "../http.js";

// 动态流：可按角色筛选，按时间倒序分页，before 传最早一条的 created_at。
export default function get(req, res, context) {
  const url = new URL(req.url, "http://localhost");
  const characterId = url.searchParams.get("character_id");
  const before = Number(url.searchParams.get("before") || 0) || Number.MAX_SAFE_INTEGER;
  let rows;
  if (characterId) {
    rows = context.db
      .prepare(
        "SELECT * FROM posts WHERE character_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT 20",
      )
      .all(characterId, before);
  } else {
    rows = context.db
      .prepare("SELECT * FROM posts WHERE created_at < ? ORDER BY created_at DESC LIMIT 20")
      .all(before);
  }
  return json(res, 200, {
    posts: rows.map((row) => context.companions.postView(row)),
    has_more: rows.length === 20,
  });
}
