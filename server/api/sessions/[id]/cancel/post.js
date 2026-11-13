import { json, fail } from "../../../http.js";

export default async function cancel(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }

  const request = context.replies.get(id);
  if (request?.running) {
    request.controller.abort(new DOMException("已停止", "AbortError"));
    await request.done;
  }
  await context.tasks.cancelChildren({ sessionId: id });
  await context.tasks.shell.cancelScope({ sessionId: id });
  return json(res, 200, { ok: true });
}
