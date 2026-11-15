import { body, fail, json } from "../../http.js";

// 根据一句想法让模型补全人设草稿，不入库，由用户确认后再创建。
export default async function post(req, res, context) {
  const data = await body(req, ["model_id", "idea"]);
  if (!context.config.models.some((model) => model.id === data.model_id)) {
    fail(400, "模型不存在");
  }
  if (data.idea !== undefined && (typeof data.idea !== "string" || data.idea.length > 2000)) {
    fail(400, "想法必须是不超过 2000 字的字符串");
  }
  let draft;
  try {
    draft = await context.companions.draft(data.model_id, (data.idea ?? "").trim());
  } catch (error) {
    fail(502, error.message);
  }
  return json(res, 200, draft);
}
