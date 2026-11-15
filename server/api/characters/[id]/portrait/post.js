import { body, fail, json } from "../../../http.js";
import { characterView } from "../../view.js";

// 按外貌描述生成头像或主页封面，等待生成完成后返回新的角色资料。
export default async function post(req, res, context, id) {
  const data = await body(req, ["kind"]);
  if (!["avatar", "cover"].includes(data.kind)) {
    fail(400, "kind 必须是 avatar 或 cover");
  }
  if (!context.db.prepare("SELECT 1 FROM characters WHERE id = ?").get(id)) {
    fail(404, "角色不存在");
  }
  try {
    await context.companions.portrait(id, data.kind);
  } catch (error) {
    fail(502, error.message);
  }
  const row = context.db.prepare("SELECT * FROM characters WHERE id = ?").get(id);
  const view = characterView(row, context);
  context.events.publish({ companion: { type: "character", character: view } });
  return json(res, 200, view);
}
