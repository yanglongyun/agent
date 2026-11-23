import message from "./[message_id]/index.js";
import get from "./get.js";
import post from "./post.js";
import { fail } from "../../../http.js";

export default async function messages(req, res, parts, context, id) {
  if (parts.length > 0) {
    return message(req, res, parts.slice(1), context, id, parts[0]);
  }
  switch (req.method) {
    case "GET":
      return get(req, res, context, id);
    case "POST":
      return post(req, res, context, id);
    default:
      fail(405, "不支持的方法");
  }
}
