import get from "./get.js";
import { fail } from "../../http.js";

export default function attachment(req, res, parts, context, id) {
  if (parts.length) {
    fail(404, "接口不存在");
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    fail(405, "不支持的方法");
  }
  return get(req, res, context, id);
}
