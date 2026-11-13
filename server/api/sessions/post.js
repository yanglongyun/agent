import { createSession } from "../../session.js";
import { body, json, fail } from "../http.js";

export default async function post(req, res, context) {
  const data = await body(req, ["title"]);
  if (
    data.title !== undefined &&
    (typeof data.title !== "string" || [...data.title.trim()].length > 120)
  ) {
    fail(400, "标题无效");
  }
  const session = createSession(context.db, data.title?.trim() || "");
  const entry = { ...session, preview: "", running: false };
  context.events.publish({ session: entry });
  return json(res, 201, entry);
}
