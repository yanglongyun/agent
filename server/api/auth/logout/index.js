import post from "./post.js";
import { fail } from "../../http.js";

export default function logout(req, res, parts, context) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "POST":
      return post(req, res, context);
    default:
      fail(405, "不支持的方法");
  }
}
