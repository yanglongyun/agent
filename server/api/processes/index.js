import get from "./get.js";
import process from "./[id]/index.js";
import { fail } from "../http.js";
export default async function processes(req, res, parts, context) {
  if (parts.length) {
    return process(req, res, parts.slice(1), context, parts[0]);
  }
  if (req.method === "GET") {
    return get(req, res, context);
  }
  fail(405, "不支持的方法");
}
