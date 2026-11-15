import { body, fail, json } from "../../../http.js";

// 保存用户评论，角色稍后在后台回复。
export default async function post(req, res, context, id) {
  const data = await body(req, ["body"]);
  if (typeof data.body !== "string" || !data.body.trim() || data.body.length > 1000) {
    fail(400, "评论必须是 1～1000 字的字符串");
  }
  if (!context.db.prepare("SELECT 1 FROM posts WHERE id = ?").get(id)) {
    fail(404, "动态不存在");
  }
  const now = Date.now();
  const result = context.db
    .prepare(
      "INSERT INTO post_comments (post_id, author, body, created_at) VALUES (?, 'user', ?, ?)",
    )
    .run(id, data.body.trim(), now);
  const comment = {
    id: Number(result.lastInsertRowid),
    post_id: id,
    author: "user",
    body: data.body.trim(),
    created_at: now,
  };
  context.events.publish({ companion: { type: "comment", post_id: id, comment } });
  context.companions.answerComment(id);
  return json(res, 201, comment);
}
