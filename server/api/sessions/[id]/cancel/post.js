import { json, fail } from "../../../http.js";

export default async function cancel(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }

  const request = context.activeReplies.get(id);
  if (request) {
    request.controller.abort(new DOMException("已停止", "AbortError"));
    await request.done;
  }
  return json(res, 200, { ok: true });
}
