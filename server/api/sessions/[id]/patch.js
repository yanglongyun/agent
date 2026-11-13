import { body, json, fail } from "../../http.js";
import { withCost } from "../../../metering/index.js";
import { messagePreview } from "../../../session.js";

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
  const first = context.db
    .prepare("SELECT item, meta FROM messages WHERE session_id = ? ORDER BY id LIMIT 1")
    .get(id);
  const entry = {
    ...withCost(session),
    preview: first ? messagePreview(JSON.parse(first.item), JSON.parse(first.meta || "null")) : "",
    running: Boolean(context.replies.get(id)?.running),
  };
  context.events.publish({ session: entry });
  return json(res, 200, entry);
}
