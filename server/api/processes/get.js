import { json, fail } from "../http.js";
export default async function get(req, res, context) {
  const sessionId = new URL(req.url, "http://localhost").searchParams.get("session_id");
  if (!sessionId || !context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)) {
    fail(404, "会话不存在");
  }
  const rows = context.db
    .prepare(
      "SELECT id FROM shell_jobs WHERE session_id = ? ORDER BY CASE WHEN status IN ('running', 'cancelling') THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT 100",
    )
    .all(sessionId);
  const processes = rows.map((row) => {
    const record = context.tasks.shell.info(row.id, { sessionId });
    const { output, ...details } = record;
    return details;
  });
  return json(res, 200, { processes });
}
