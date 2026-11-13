import get from "./get.js";
import stdio from "./stdio/index.js";
import { fail } from "../../http.js";
export default async function process(req, res, parts, context, id) {
  const row = context.db.prepare("SELECT id FROM shell_jobs WHERE id = ?").get(id);
  if (!row) {
    fail(404, "后台命令不存在");
  }
  if (parts.length) {
    if (parts[0] === "stdio") {
      return stdio(req, res, parts.slice(1), context, id);
    }
    fail(404, "接口不存在");
  }
  if (req.method === "GET") {
    return get(req, res, context, id);
  }
  fail(405, "不支持的方法");
}
