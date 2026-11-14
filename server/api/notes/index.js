import get from "./get.js";
import post from "./post.js";
import note from "./[id]/index.js";
import { fail } from "../http.js";

export default async function notes(req, res, parts, context) {
  if (parts.length > 0) {
    const id = parts[0];
    return note(req, res, parts.slice(1), context, id);
  }

  switch (req.method) {
    case "GET":
      return get(req, res, context);
    case "POST":
      return post(req, res, context);
    default:
      fail(405, "不支持的方法");
  }
}
