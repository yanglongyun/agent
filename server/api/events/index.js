import get from "./get.js";
import { fail } from "../http.js";

export default function events(req, res, parts, context) {
  if (parts.length) {
    fail(404, "接口不存在");
  }
  if (req.method !== "GET") {
    fail(405, "不支持的方法");
  }
  return get(req, res, context);
}
