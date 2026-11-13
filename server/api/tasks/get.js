import { json, fail } from "../http.js";
import { withCost } from "../../metering/index.js";

export default async function get(req, res, context) {
  const sessionId = new URL(req.url, "http://localhost").searchParams.get("session_id");
  const session = sessionId
    ? context.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId)
    : null;
  if (!session) {
    fail(404, "会话不存在");
  }
  const rows = context.db
    .prepare(
      "SELECT id FROM tasks WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
    )
    .all(sessionId);
  return json(res, 200, {
    tasks: rows.map((row) => context.tasks.info(row.id, { sessionId })),
    session: withCost(session),
  });
}
