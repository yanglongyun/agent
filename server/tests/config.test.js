import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaults, paths, loadConfig, validateConfig } from "../config.js";

test("当前配置在文件读取边界校验，不补缺失字段", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locations = paths({ AGENT_HOME: root });
  const initial = loadConfig(locations, {});
  assert.ok(initial.api.token.length >= 16);
  const config = defaults();
  config.api.token = "test-access-token-123456";
  delete config.keep;
  const raw = JSON.stringify(config);
  await fs.writeFile(locations.config, raw);
  assert.throws(() => loadConfig(locations, {}), /keep/);
  assert.equal(await fs.readFile(locations.config, "utf8"), raw);
});
test("配置拒绝无效 URL、窗口阈值、监听地址和未知字段", () => {
  const config = {
    ...defaults(),
    api: { token: "test-access-token-123456", listen: "127.0.0.1:0" },
  };
  validateConfig(config);
  assert.throws(() => validateConfig({ ...config, url: "file:///tmp/model" }), /HTTP/);
  assert.throws(
    () => validateConfig({ ...config, context_window: 100, compact_at: 100 }),
    /压缩阈值/,
  );
  assert.throws(
    () => validateConfig({ ...config, context_window: 100, compact_at: 101 }),
    /压缩阈值/,
  );
  validateConfig({ ...config, context_window: 100, compact_at: 99 });
  assert.throws(
    () => validateConfig({ ...config, api: { ...config.api, listen: "localhost:65536" } }),
    /监听地址/,
  );
  assert.throws(() => validateConfig({ ...config, unused_field: true }), /未知配置/);
});
