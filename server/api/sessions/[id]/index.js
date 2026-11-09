import get from "./get.js";
import patch from "./patch.js";
import remove from "./delete.js";
import messages from "./messages/index.js";
import compactions from "./compactions/index.js";
import cancel from "./cancel/index.js";
import { fail } from "../../http.js";

export default async function session(req, res, parts, context, id) {
  if (parts.length > 0) {
    const name = parts[0];
    const rest = parts.slice(1);
    switch (name) {
      case "messages":
        return messages(req, res, rest, context, id);
      case "compactions":
        return compactions(req, res, rest, context, id);
      case "cancel":
        return cancel(req, res, rest, context, id);
      default:
        fail(404, "接口不存在");
    }
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
