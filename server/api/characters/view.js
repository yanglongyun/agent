import { fail } from "../http.js";

// 角色接口共用的字段校验与返回结构。
export function characterView(row, context) {
  const last = context.db
    .prepare(
      "SELECT role, body, image, created_at FROM character_messages WHERE character_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(row.id);
  let preview = null;
  if (last) {
    preview = {
      role: last.role,
      text: last.image ? "[照片]" : last.body,
      created_at: last.created_at,
    };
  }
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    persona: row.persona,
    appearance: row.appearance,
    memory: row.memory,
    avatar: row.avatar,
    cover: row.cover,
    model_id: row.model_id,
    posting: Boolean(row.posting),
    last_message: preview,
    ...context.companions.status(row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
    next_post_at: row.next_post_at,
  };
}

const limits = { name: 40, tagline: 60, persona: 6000, appearance: 1000, memory: 8000 };

// 只校验请求里出现的字段；创建时由调用方另外检查必填项。
export function checkFields(data, context) {
  for (const [key, limit] of Object.entries(limits)) {
    if (!(key in data)) {
      continue;
    }
    if (typeof data[key] !== "string" || [...data[key]].length > limit) {
      fail(400, `${key} 必须是不超过 ${limit} 字的字符串`);
    }
  }
  if ("name" in data && !data.name.trim()) {
    fail(400, "名字不能为空");
  }
  if ("persona" in data && !data.persona.trim()) {
    fail(400, "人设不能为空");
  }
  if ("model_id" in data && !context.config.models.some((model) => model.id === data.model_id)) {
    fail(400, "模型不存在");
  }
  if ("posting" in data && typeof data.posting !== "boolean") {
    fail(400, "posting 必须是布尔值");
  }
}
