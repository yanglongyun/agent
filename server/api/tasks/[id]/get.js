import { json } from "../../http.js";

export default async function get(req, res, context, id) {
  const task = context.db.prepare("SELECT session_id FROM tasks WHERE id = ?").get(id);
  return json(res, 200, context.tasks.info(id, { sessionId: task.session_id }));
}
