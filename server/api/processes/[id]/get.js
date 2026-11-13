import { json } from "../../http.js";
export default async function get(req, res, context, id) {
  const row = context.db.prepare("SELECT session_id FROM shell_jobs WHERE id = ?").get(id);
  return json(res, 200, context.tasks.shell.info(id, { sessionId: row.session_id }));
}
