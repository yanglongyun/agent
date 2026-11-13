import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"))).version;
export const defaults = () =>
  JSON.parse(fs.readFileSync(new URL("./defaults.json", import.meta.url)));
export const newToken = () => randomBytes(32).toString("hex");

export function paths(env = process.env, platform = process.platform, home = os.homedir()) {
  let base;
  if (platform === "darwin") {
    base = path.join(home, "Library", "Application Support");
  } else if (platform === "win32") {
    base = env.APPDATA || home;
  } else {
    base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  }
  const root = path.resolve(env.AGENT_HOME || path.join(base, "agentic"));
  return {
    root,
    config: path.join(root, "config.json"),
    db: path.join(root, "agent.db"),
    images: path.join(root, "images"),
    attachments: path.join(root, "attachments"),
  };
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("配置必须是对象");
  }
  const fields = [
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
  ];
  for (const key of Object.keys(config)) {
    if (!fields.includes(key)) {
      throw new Error(`未知配置字段：${key}`);
    }
  }
  for (const key of ["system", "compact_system", "compact_prefix", "workdir"]) {
    if (typeof config[key] !== "string") {
      throw new Error(`${key} 必须是字符串`);
    }
  }
  if (!Array.isArray(config.models)) {
    throw new Error("models 必须是数组");
  }
  const ids = new Set();
  for (const model of config.models) {
    if (!model || typeof model !== "object" || Array.isArray(model)) {
      throw new Error("模型配置必须是对象");
    }
    for (const key of Object.keys(model)) {
      if (!["id", "name", "model", "url", "key", "protocol", "context_window"].includes(key)) {
        throw new Error(`未知模型字段：${key}`);
      }
    }
    for (const key of ["id", "name", "model", "url", "key", "protocol"]) {
      if (typeof model[key] !== "string" || !model[key].trim()) {
        throw new Error(`模型 ${key} 不能为空`);
      }
    }
    if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model.id) || ids.has(model.id)) {
      throw new Error("模型标识无效或重复");
    }
    ids.add(model.id);
    if (!["responses", "chat-completions", "anthropic-messages"].includes(model.protocol)) {
      throw new Error("模型协议必须是 responses、chat-completions 或 anthropic-messages");
    }
    if (
      !Number.isSafeInteger(model.context_window) ||
      (model.context_window !== 0 && model.context_window < 2)
    ) {
      throw new Error("模型上下文窗口必须为 0 或大于 1 的整数");
    }
    let address;
    try {
      address = new URL(model.url);
    } catch {
      throw new Error("模型接口地址无效");
    }
    if (!["http:", "https:"].includes(address.protocol)) {
      throw new Error("模型接口地址必须使用 HTTP 或 HTTPS");
    }
  }
  if (typeof config.compact_on_cache_expiry !== "boolean") {
    throw new Error("compact_on_cache_expiry 必须是布尔值");
  }
  for (const key of ["compact_at", "cache_ttl", "keep", "run_timeout", "timeout", "max_output"]) {
    const minimum = 1;
    if (!Number.isSafeInteger(config[key]) || config[key] < minimum) {
      throw new Error(`${key} 必须是大于等于 ${minimum} 的整数`);
    }
  }
  if (
    config.workdir &&
    (!path.isAbsolute(config.workdir) || !fs.statSync(config.workdir).isDirectory())
  ) {
    throw new Error("工作目录必须是已存在的绝对目录");
  }
  if (!config.api || typeof config.api !== "object" || Array.isArray(config.api)) {
    throw new Error("api 必须是对象");
  }
  for (const key of Object.keys(config.api)) {
    if (!["listen", "token"].includes(key)) {
      throw new Error(`未知 api 字段：${key}`);
    }
  }
  if (typeof config.api.token !== "string" || config.api.token.length < 6) {
    throw new Error("api.token 至少需要 6 字符");
  }
  const listen =
    typeof config.api.listen === "string" && /^(?:\[[^\]]+\]|[^:]*):(\d+)$/.exec(config.api.listen);
  if (!listen || Number(listen[1]) > 65535) {
    throw new Error("监听地址无效");
  }
}

export function saveConfig(locations, config) {
  validateConfig(config);
  fs.mkdirSync(locations.root, { recursive: true, mode: 0o700 });
  const temp = `${locations.config}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(temp, locations.config);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export function loadConfig(locations = paths(), env = process.env) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(locations.config, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`配置文件读取失败：${error.message}`);
    }
    config = defaults();
    config.api.token = newToken();
    saveConfig(locations, config);
  }
  validateConfig(config);
  if (env.AGENT_SYSTEM) {
    config.system = env.AGENT_SYSTEM;
  }
  if (env.AGENT_SERVER_TOKEN) {
    config.api.token = env.AGENT_SERVER_TOKEN;
  }
  if (env.AGENT_LISTEN) {
    config.api.listen = env.AGENT_LISTEN;
  }
  validateConfig(config);
  return config;
}

// 配置表是模型连接的唯一来源；执行前取独立快照，设置修改不影响进行中的请求。
export function requireModel(config, id) {
  const model = config.models.find((item) => item.id === id);
  if (!model) {
    throw new Error("请先在设置中添加并选择模型");
  }
  return model;
}

export function runConfig(config, id, compactId) {
  if (!id) {
    throw new Error("请选择对话模型");
  }
  if (!compactId) {
    throw new Error("请选择压缩模型");
  }
  const model = requireModel(config, id);
  const compact = requireModel(config, compactId);
  const compactAt =
    model.context_window > 0
      ? Math.min(config.compact_at, model.context_window - 1)
      : config.compact_at;
  return {
    ...config,
    ...model,
    model_id: model.id,
    compact_at: compactAt,
    compact_connection: { ...compact },
  };
}

export function modelView(model) {
  return {
    id: model.id,
    name: model.name,
    model: model.model,
    protocol: model.protocol,
    context_window: model.context_window,
  };
}
