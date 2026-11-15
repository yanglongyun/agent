import fs from "node:fs/promises";
import path from "node:path";
import { fail, json } from "../../http.js";

export default async function remove(req, res, context, id) {
  const db = context.db;
  const row = db.prepare("SELECT images FROM posts WHERE id = ?").get(id);
  if (!row) {
    fail(404, "动态不存在");
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM post_comments WHERE post_id = ?").run(id);
    db.prepare("DELETE FROM posts WHERE id = ?").run(id);
    db.prepare("UPDATE character_messages SET post_id = NULL WHERE post_id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const url of JSON.parse(row.images || "[]")) {
    await fs.rm(path.join(context.paths.images, path.basename(url)), { force: true });
  }
  context.events.publish({ companion: { type: "post_deleted", post_id: id } });
  return json(res, 200, { deleted: id });
}
