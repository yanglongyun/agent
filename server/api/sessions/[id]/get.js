import { json, fail } from "../../http.js";
import { withCost } from "../../../metering/index.js";

export default async function get(req, res, context, id) {
  const session = context.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!session) {
    fail(404, "会话不存在");
  }
  return json(res, 200, {
    ...withCost(session),
    running: Boolean(context.replies.get(id)?.running),
  });
}
