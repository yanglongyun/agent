import { body, json, fail } from "../http.js";
import { runConfig } from "../../config.js";

export default async function post(req, res, context) {
  const args = await body(req, ["session_id", "task", "model_id", "compact_model_id", "context"]);
  if (
    typeof args.session_id !== "string" ||
    !context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(args.session_id)
  ) {
    fail(404, "会话不存在");
  }
  try {
    const selected = runConfig(context.config, args.model_id, args.compact_model_id);
    const scope = {
      sessionId: args.session_id,
      modelId: selected.model_id,
      compactModelId: selected.compact_connection.id,
    };
    const task = context.tasks.start(args, scope, context.config, null);
    return json(res, 201, task);
  } catch (error) {
    fail(400, error.message);
  }
}
