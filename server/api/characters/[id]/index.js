import get from "./get.js";
import patch from "./patch.js";
import remove from "./delete.js";
import messages from "./messages/index.js";
import portrait from "./portrait/index.js";
import posts from "./posts/index.js";
import { fail } from "../../http.js";

export default async function character(req, res, parts, context, id) {
  if (parts[0] === "messages") {
    return messages(req, res, parts.slice(1), context, id);
  }
  if (parts[0] === "portrait") {
    return portrait(req, res, parts.slice(1), context, id);
  }
  if (parts[0] === "posts") {
    return posts(req, res, parts.slice(1), context, id);
  }
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "GET":
      return get(req, res, context, id);
    case "PATCH":
      return patch(req, res, context, id);
    case "DELETE":
      return remove(req, res, context, id);
    default:
      fail(405, "不支持的方法");
  }
}
