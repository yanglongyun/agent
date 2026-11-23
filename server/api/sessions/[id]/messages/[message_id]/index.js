import { fail } from "../../../../http.js";
import recall from "./recall/index.js";

export default function message(req, res, parts, context, id, messageId) {
  if (parts[0] === "recall") {
    return recall(req, res, parts.slice(1), context, id, messageId);
  }
  fail(404, "接口不存在");
}
