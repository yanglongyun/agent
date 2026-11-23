import { fail } from "../../../http.js";
import get from "./get.js";

export default function usage(req, res, parts, context, id) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  if (req.method !== "GET") {
    fail(405, "不支持的方法");
  }
  return get(req, res, context, id);
}
