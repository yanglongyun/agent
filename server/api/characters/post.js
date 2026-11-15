import { randomUUID } from "node:crypto";
import { body, fail, json } from "../http.js";
import { characterView, checkFields } from "./view.js";

export default async function post(req, res, context) {
  const data = await body(req, ["name", "tagline", "persona", "appearance", "model_id", "posting"]);
  for (const key of ["name", "persona", "model_id"]) {
    if (!(key in data)) {
      fail(400, `缺少 ${key}`);
    }
  }
  checkFields(data, context);
  const now = Date.now();
  const id = randomUUID();
  // 新角色几分钟后发第一条动态，之后按作息排期。
  context.db
    .prepare(
      `INSERT INTO characters (id, name, tagline, persona, appearance, memory, avatar, cover, model_id, posting, created_at, updated_at, next_post_at)
       VALUES (?, ?, ?, ?, ?, '', NULL, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name.trim(),
      (data.tagline ?? "").trim(),
      data.persona.trim(),
      (data.appearance ?? "").trim(),
      data.model_id,
      data.posting === false ? 0 : 1,
      now,
      now,
      now + 3 * 60 * 1000,
    );
  const row = context.db.prepare("SELECT * FROM characters WHERE id = ?").get(id);
  const view = characterView(row, context);
  context.events.publish({ companion: { type: "character", character: view } });
  return json(res, 201, view);
}
