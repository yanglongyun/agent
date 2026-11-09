import { randomUUID } from "node:crypto";
import { body, json, fail } from "../http.js";

export default async function post(req, res, context) {
  const data = await body(req, ["title"]);
  if (
    data.title !== undefined &&
    (typeof data.title !== "string" || [...data.title.trim()].length > 120)
  ) {
    fail(400, "标题无效");
  }
  const id = randomUUID();
  const title = data.title?.trim() || "";
  const now = Date.now();
  context.db
    .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, title, now, now);
  return json(res, 201, {
    id,
    title,
    created_at: now,
    updated_at: now,
    preview: "",
    running: false,
  });
}
