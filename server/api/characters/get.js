import { json } from "../http.js";
import { characterView } from "./view.js";

// 列表按最近聊天时间排序，没有聊过的按创建时间。
export default function get(req, res, context) {
  const rows = context.db
    .prepare(
      `SELECT c.* FROM characters c
       LEFT JOIN (SELECT character_id, MAX(created_at) AS at FROM character_messages GROUP BY character_id) m
         ON m.character_id = c.id
       ORDER BY COALESCE(m.at, c.created_at) DESC`,
    )
    .all();
  return json(res, 200, { characters: rows.map((row) => characterView(row, context)) });
}
