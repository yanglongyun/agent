import attachment from "./[id]/index.js";
import { fail } from "../http.js";

export default function attachments(req, res, parts, context) {
  if (!parts[0]) {
    fail(404, "附件不存在");
  }
  return attachment(req, res, parts.slice(1), context, parts[0]);
}
