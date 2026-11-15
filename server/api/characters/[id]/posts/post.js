import { fail, json } from "../../../http.js";

// 让角色马上发一条动态；生成在后台进行，完成后通过事件流推送。
export default function post(req, res, context, id) {
  const character = context.db.prepare("SELECT model_id FROM characters WHERE id = ?").get(id);
  if (!character) {
    fail(404, "角色不存在");
  }
  if (!context.config.models.some((model) => model.id === character.model_id)) {
    fail(400, "角色使用的模型已被删除，请在角色资料里重新选择");
  }
  const started = context.companions.post(id);
  return json(res, 202, { started });
}
