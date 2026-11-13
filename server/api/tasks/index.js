import get from "./get.js";
import post from "./post.js";
import task from "./[id]/index.js";
import { fail } from "../http.js";

export default async function tasks(req, res, parts, context) {
  if (parts.length) {
    return task(req, res, parts.slice(1), context, parts[0]);
  }
  if (req.method === "GET") {
    return get(req, res, context);
  }
  if (req.method === "POST") {
    return post(req, res, context);
  }
  fail(405, "不支持的方法");
}
