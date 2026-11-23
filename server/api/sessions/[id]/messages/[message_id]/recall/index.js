import { fail } from "../../../../../http.js";
import post from "./post.js";

export default function recall(req, res, parts, context, id, messageId) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  if (req.method !== "POST") {
    fail(405, "不支持的方法");
  }
  return post(req, res, context, id, Number(messageId));
}
