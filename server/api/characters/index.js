import get from "./get.js";
import post from "./post.js";
import drafts from "./drafts/index.js";
import character from "./[id]/index.js";
import { fail } from "../http.js";

export default async function characters(req, res, parts, context) {
  if (parts[0] === "drafts") {
    return drafts(req, res, parts.slice(1), context);
  }
  if (parts.length > 0) {
    return character(req, res, parts.slice(1), context, parts[0]);
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
