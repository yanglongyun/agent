import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaults, paths, loadConfig, validateConfig, runConfig } from "../config.js";
import { configured } from "./config-fixture.js";

const api = { token: "test-access-token-123456", listen: "127.0.0.1:0" };

test("当前配置在文件读取边界校验，不补缺失字段", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locations = paths({ AGENT_HOME: root });
  const initial = loadConfig(locations, {});
  assert.ok(initial.api.token.length >= 16);
  assert.deepEqual(initial.models, []);
  const config = configured({}, { api });
  delete config.keep;
  const raw = JSON.stringify(config);
  await fs.writeFile(locations.config, raw);
  assert.throws(() => loadConfig(locations, {}), /keep/);
  assert.equal(await fs.readFile(locations.config, "utf8"), raw);
});

test("模型列表校验协议、地址、标识和选择引用；执行快照使用各自连接与窗口", () => {
  const config = configured({}, { api });
  validateConfig(config);
  for (const change of [
    { url: "file:///tmp/model" },
    { protocol: "unknown" },
    { id: "" },
    { key: "" },
    { context_window: 1 },
  ]) {
    assert.throws(() =>
      validateConfig({ ...config, models: [{ ...config.models[0], ...change }, config.models[1]] }),
    );
  }
  assert.throws(
    () => validateConfig({ ...config, models: [config.models[0], config.models[0]] }),
    /重复/,
  );
  assert.throws(
    () => validateConfig({ ...config, api: { ...api, listen: "localhost:65536" } }),
    /监听地址/,
  );
  assert.throws(() => validateConfig({ ...config, unused_field: true }), /未知配置/);
  config.models[0].context_window = 100;
  config.models[1].protocol = "anthropic-messages";
  config.models[1].url = "https://summary.invalid/messages";
  config.models[1].key = "summary-key";
  const runtime = runConfig(config, "main", "compact");
  assert.throws(() => runConfig(config), /请选择对话模型/);
  assert.throws(() => runConfig(config, "main"), /请选择压缩模型/);
  assert.equal(runtime.compact_at, 99);
  assert.equal(config.compact_at, 60000);
  assert.equal(runtime.compact_connection.url, "https://summary.invalid/messages");
  assert.equal(runtime.compact_connection.protocol, "anthropic-messages");
  config.models[1].key = "changed-after-start";
  assert.equal(runtime.compact_connection.key, "summary-key");
  assert.throws(() => runConfig(config, "absent", "compact"), /添加并选择/);
});

test("缓存有效期和开关只接受明确类型", () => {
  const config = configured({}, { api });
  for (const value of [0, -1, 1.5, "300", null]) {
    assert.throws(() => validateConfig({ ...config, cache_ttl: value }), /cache_ttl/);
  }
  for (const value of [1, "true", null, undefined]) {
    assert.throws(() => validateConfig({ ...config, compact_on_cache_expiry: value }), /布尔/);
  }
  validateConfig({ ...config, compact_on_cache_expiry: true, cache_ttl: 3600 });
});

test("访问令牌支持六字符，拒绝空值和过短值", () => {
  const config = defaults();
  config.api.token = "abcdef";
  validateConfig(config);
  for (const token of ["", "abcde", null, 123456]) {
    assert.throws(() => validateConfig({ ...config, api: { ...config.api, token } }), /api.token/);
  }
});
