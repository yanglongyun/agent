import fs from "node:fs/promises";
import path from "node:path";
import { fail, json } from "../../http.js";

// 删除角色及其聊天、动态、评论，并清理这些记录引用的图片文件。
export default async function remove(req, res, context, id) {
  const db = context.db;
  const character = db.prepare("SELECT * FROM characters WHERE id = ?").get(id);
  if (!character) {
    fail(404, "角色不存在");
  }
  const images = [character.avatar, character.cover];
  for (const row of db
    .prepare("SELECT image FROM character_messages WHERE character_id = ? AND image IS NOT NULL")
    .all(id)) {
    images.push(row.image);
  }
  for (const row of db.prepare("SELECT images FROM posts WHERE character_id = ?").all(id)) {
    images.push(...JSON.parse(row.images || "[]"));
  }
  db.exec("BEGIN");
  try {
    db.prepare(
      "DELETE FROM post_comments WHERE post_id IN (SELECT id FROM posts WHERE character_id = ?)",
    ).run(id);
    db.prepare("DELETE FROM posts WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM character_messages WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM characters WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const url of images) {
    if (url) {
      await fs.rm(path.join(context.paths.images, path.basename(url)), { force: true });
    }
  }
  context.events.publish({ companion: { type: "deleted", character_id: id } });
  return json(res, 200, { deleted: id });
}
