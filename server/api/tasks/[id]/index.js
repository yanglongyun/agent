import get from "./get.js";
import messages from "./messages/index.js";
import compactions from "./compactions/index.js";
import cancel from "./cancel/index.js";
import { fail } from "../../http.js";

export default async function task(req, res, parts, context, id) {
  const row = context.db.prepare("SELECT id FROM tasks WHERE id = ?").get(id);
  if (!row) {
    fail(404, "任务不存在");
  }
  if (parts.length) {
    switch (parts[0]) {
      case "messages":
        return messages(req, res, parts.slice(1), context, id);
      case "compactions":
        return compactions(req, res, parts.slice(1), context, id);
      case "cancel":
        return cancel(req, res, parts.slice(1), context, id);
      default:
        fail(404, "接口不存在");
    }
  }
  if (req.method === "GET") {
    return get(req, res, context, id);
  }
  fail(405, "不支持的方法");
}
