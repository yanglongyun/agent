import { body, json, fail } from "../../http.js";

export default async function patch(req, res, context, id) {
  const { title } = await body(req, ["title"]);
  if (typeof title !== "string" || [...title.trim()].length > 120) {
    fail(400, "标题最多 120 字符");
  }
  context.db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title.trim(), id);
  const session = context.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!session) {
    fail(404, "会话不存在");
  }
  return json(res, 200, { ...session, running: context.activeReplies.has(id) });
}
