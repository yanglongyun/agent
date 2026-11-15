import { body, fail, json } from "../../http.js";

// 目前只有点赞状态可以修改。
export default async function patch(req, res, context, id) {
  const data = await body(req, ["liked"]);
  if (typeof data.liked !== "boolean") {
    fail(400, "liked 必须是布尔值");
  }
  const updated = context.db
    .prepare("UPDATE posts SET liked = ? WHERE id = ?")
    .run(data.liked ? 1 : 0, id);
  if (updated.changes !== 1) {
    fail(404, "动态不存在");
  }
  const row = context.db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  const view = context.companions.postView(row);
  context.events.publish({ companion: { type: "post", post: view } });
  return json(res, 200, view);
}
