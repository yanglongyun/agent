import { body, json, fail } from "../../http.js";
import { withCost } from "../../../metering/index.js";
import { messagePreview } from "../../../session.js";

// 修改标题和/或置顶状态。pinned 为 true 时排到置顶组最前，false 时取消置顶。
export default async function patch(req, res, context, id) {
  const data = await body(req, ["title", "pinned"]);
  if (!("title" in data) && !("pinned" in data)) {
    fail(400, "没有可修改的字段");
  }
  if ("title" in data && (typeof data.title !== "string" || [...data.title.trim()].length > 120)) {
    fail(400, "标题最多 120 字符");
  }
  if ("pinned" in data && typeof data.pinned !== "boolean") {
    fail(400, "pinned 必须是布尔值");
  }
  const db = context.db;
  const current = db.prepare("SELECT pinned FROM sessions WHERE id = ?").get(id);
  if (!current) {
    fail(404, "会话不存在");
  }
  if ("title" in data) {
    db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(data.title.trim(), id);
  }
  if (data.pinned === true && current.pinned === null) {
    db.prepare(
      "UPDATE sessions SET pinned = COALESCE((SELECT MIN(pinned) FROM sessions), 0) - 1 WHERE id = ?",
    ).run(id);
  }
  if (data.pinned === false) {
    db.prepare("UPDATE sessions SET pinned = NULL WHERE id = ?").run(id);
  }
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  const first = db
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
