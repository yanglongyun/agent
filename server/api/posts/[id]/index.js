import patch from "./patch.js";
import remove from "./delete.js";
import comments from "./comments/index.js";
import { fail } from "../../http.js";

export default async function post(req, res, parts, context, id) {
  if (parts[0] === "comments") {
    return comments(req, res, parts.slice(1), context, id);
  }
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "PATCH":
      return patch(req, res, context, id);
    case "DELETE":
      return remove(req, res, context, id);
    default:
      fail(405, "不支持的方法");
  }
}
