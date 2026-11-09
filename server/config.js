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
    db: path.join(root, "chat.db"),
    images: path.join(root, "images"),
  };
}

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("配置必须是对象");
  }
  const fields = [
    "url",
    "key",
    "model",
    "protocol",
    "context_window",
    "system",
    "compact_at",
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
  for (const key of [
    "url",
    "key",
    "model",
    "protocol",
    "system",
    "compact_system",
    "compact_prefix",
    "workdir",
  ]) {
    if (typeof config[key] !== "string") {
      throw new Error(`${key} 必须是字符串`);
    }
  }
  if (!["responses", "anthropic-messages"].includes(config.protocol)) {
    throw new Error("protocol 必须是 responses 或 anthropic-messages");
  }
  for (const key of [
    "context_window",
    "compact_at",
    "keep",
    "run_timeout",
    "timeout",
    "max_output",
  ]) {
    const minimum = key === "context_window" ? 0 : 1;
    if (!Number.isSafeInteger(config[key]) || config[key] < minimum) {
      throw new Error(`${key} 必须是大于等于 ${minimum} 的整数`);
    }
  }
  if (config.context_window > 0 && config.compact_at >= config.context_window) {
    throw new Error("压缩阈值必须小于模型上下文窗口");
  }
  if (config.url) {
    let address;
    try {
      address = new URL(config.url);
    } catch {
      throw new Error("模型接口地址无效");
    }
    if (!["http:", "https:"].includes(address.protocol)) {
      throw new Error("模型接口地址必须使用 HTTP 或 HTTPS");
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
  if (typeof config.api.token !== "string" || config.api.token.length < 16) {
    throw new Error("api.token 至少需要 16 字符");
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
  if (env.AGENT_URL) {
    config.url = env.AGENT_URL;
  }
  if (env.AGENT_KEY) {
    config.key = env.AGENT_KEY;
  }
  if (env.AGENT_MODEL) {
    config.model = env.AGENT_MODEL;
  }
  if (env.AGENT_PROTOCOL) {
    config.protocol = env.AGENT_PROTOCOL;
  }
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

export function requireModel(config) {
  if (!config.url || !config.key || !config.model) {
    throw new Error("尚未配置模型：请在设置中填写接口地址、API Key 和模型");
  }
}

export function renderPrompt(text, workdir = process.cwd()) {
  const values = {
    os: process.platform === "win32" ? "windows" : process.platform,
    arch: process.arch === "x64" ? "amd64" : process.arch,
    host: os.hostname(),
    user: os.userInfo().username,
    workdir: workdir || process.cwd(),
    time: new Date().toISOString(),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => values[name] ?? match);
}
