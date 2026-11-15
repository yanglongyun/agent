import { body, fail, json } from "../../../http.js";

// 保存用户消息后立即返回，角色的回复通过事件流陆续推送。
export default async function post(req, res, context, id) {
  const data = await body(req, ["body"]);
  if (typeof data.body !== "string" || !data.body.trim() || data.body.length > 4000) {
    fail(400, "消息必须是 1～4000 字的字符串");
  }
  const db = context.db;
  const character = db.prepare("SELECT model_id FROM characters WHERE id = ?").get(id);
  if (!character) {
    fail(404, "角色不存在");
  }
  if (!context.config.models.some((model) => model.id === character.model_id)) {
    fail(400, "角色使用的模型已被删除，请在角色资料里重新选择");
  }
  const now = Date.now();
  const result = db
    .prepare(
      "INSERT INTO character_messages (character_id, role, body, image, post_id, created_at) VALUES (?, 'user', ?, NULL, NULL, ?)",
    )
    .run(id, data.body.trim(), now);
  const saved = {
    id: Number(result.lastInsertRowid),
    character_id: id,
    role: "user",
    body: data.body.trim(),
    image: null,
    post_id: null,
    created_at: now,
  };
  context.events.publish({ companion: { type: "message", character_id: id, message: saved } });
  context.companions.reply(id);
  return json(res, 202, saved);
}
