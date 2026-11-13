import { saveConfig, validateConfig } from "../../config.js";
import { body, json, fail } from "../http.js";

export default async function put(req, res, context) {
  const patch = await body(
    req,
    [
      "models",
      "system",
      "compact_at",
      "compact_on_cache_expiry",
      "cache_ttl",
      "keep",
      "compact_system",
      "compact_prefix",
      "workdir",
      "run_timeout",
      "timeout",
      "max_output",
      "api",
    ],
    512 * 1024,
  );
  const next = { ...context.config, api: { ...context.config.api } };

  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case "models": {
        if (!Array.isArray(value)) {
          fail(400, "models 必须是数组");
        }
        next.models = value.map((model) => {
          if (!model || typeof model !== "object" || Array.isArray(model)) {
            fail(400, "模型配置必须是对象");
          }
          const saved = context.config.models.find((item) => item.id === model.id);
          const item = { ...model };
          for (const key of ["id", "name", "model", "url", "key", "protocol"]) {
            if (typeof item[key] === "string") {
              item[key] = item[key].trim();
            }
          }
          if (item.key === "" && saved) {
            item.key = saved.key;
          }
          return item;
        });
        break;
      }
      case "workdir": {
        if (typeof value !== "string") {
          fail(400, `${key} 必须是字符串`);
        }
        next[key] = value.trim();
        break;
      }
      case "system":
      case "compact_system":
      case "compact_prefix":
      case "compact_at":
      case "compact_on_cache_expiry":
      case "cache_ttl":
      case "keep":
      case "run_timeout":
      case "timeout":
      case "max_output": {
        next[key] = value;
        break;
      }
      case "api": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          fail(400, "api 必须是对象");
        }
        for (const field of Object.keys(value)) {
          if (field !== "listen") {
            fail(400, "api 只接受 listen");
          }
        }
        if (value.listen === undefined) {
          break;
        }
        next.api.listen = value.listen;
        break;
      }
    }
  }

  try {
    validateConfig(next);
  } catch (error) {
    fail(400, error.message);
  }

  const restartRequired = next.api.listen !== context.config.api.listen;
  saveConfig(context.paths, next);
  context.config = next;
  return json(res, 200, { restart_required: restartRequired });
}
