import { body, json, fail } from "../../http.js";
import { readSessions } from "../get.js";

// 一次性设定整个置顶组：ids 的顺序就是显示顺序，不在 ids 里的会话取消置顶。
// 拖拽排序、拖入置顶、拖出取消都走这一个接口，结果由事务保证整体生效。
export default async function put(req, res, context) {
  const { ids } = await body(req, ["ids"]);
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  ) {
    fail(400, "ids 必须是不重复的会话 ID 数组");
  }
  const db = context.db;
  const known = db
    .prepare("SELECT COUNT(*) AS n FROM sessions WHERE id IN (SELECT value FROM json_each(?))")
    .get(JSON.stringify(ids)).n;
  if (known !== ids.length) {
    fail(404, "会话不存在");
  }
  const before = new Map(
    db
      .prepare("SELECT id, pinned FROM sessions")
      .all()
      .map((row) => [row.id, row.pinned]),
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE sessions SET pinned = NULL WHERE pinned IS NOT NULL").run();
    const pin = db.prepare("UPDATE sessions SET pinned = ? WHERE id = ?");
    ids.forEach((id, index) => pin.run(index, id));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const sessions = readSessions(context);
  // 只向其他页面推送置顶状态真正变化的会话。
  for (const session of sessions) {
    if (before.get(session.id) !== session.pinned) {
      context.events.publish({ session });
    }
  }
  return json(res, 200, { sessions });
}
