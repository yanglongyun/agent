import get from "./get.js";
import post from "./[id]/index.js";
import { fail } from "../http.js";

export default async function posts(req, res, parts, context) {
  if (parts.length > 0) {
    return post(req, res, parts.slice(1), context, parts[0]);
  }
  if (req.method !== "GET") {
    fail(405, "不支持的方法");
  }
  return get(req, res, context);
}
