import { json } from "../../../http.js";

export default async function cancel(req, res, context, id) {
  const task = context.db.prepare("SELECT session_id FROM tasks WHERE id = ?").get(id);
  return json(res, 200, await context.tasks.cancel(id, { sessionId: task.session_id }));
}
