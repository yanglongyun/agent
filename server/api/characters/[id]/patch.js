import { body, fail, json } from "../../http.js";
import { characterView, checkFields } from "../view.js";

export default async function patch(req, res, context, id) {
  const fields = ["name", "tagline", "persona", "appearance", "memory", "model_id", "posting"];
  const data = await body(req, fields);
  checkFields(data, context);
  const db = context.db;
  const current = db.prepare("SELECT * FROM characters WHERE id = ?").get(id);
  if (!current) {
    fail(404, "角色不存在");
  }
  const next = { ...current };
  for (const key of fields) {
    if (!(key in data)) {
      continue;
    }
    if (key === "posting") {
      next.posting = data.posting ? 1 : 0;
    } else if (key === "model_id") {
      next.model_id = data.model_id;
    } else {
      next[key] = data[key].trim();
    }
  }
  next.updated_at = Date.now();
  db.prepare(
    "UPDATE characters SET name = ?, tagline = ?, persona = ?, appearance = ?, memory = ?, model_id = ?, posting = ?, updated_at = ? WHERE id = ?",
  ).run(
    next.name,
    next.tagline,
    next.persona,
    next.appearance,
    next.memory,
    next.model_id,
    next.posting,
    next.updated_at,
    id,
  );
  const view = characterView(next, context);
  context.events.publish({ companion: { type: "character", character: view } });
  return json(res, 200, view);
}
