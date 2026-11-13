import post from "./post.js";
import { fail } from "../../../http.js";

export default async function branches(req, res, parts, context, id) {
  if (parts.length) {
    fail(404, "接口不存在");
  }
  if (req.method !== "POST") {
    fail(405, "不支持的方法");
  }
  return post(req, res, context, id);
}
