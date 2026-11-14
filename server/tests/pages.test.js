import { configured } from "./config-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../index.js";
import { paths } from "../config.js";

test("页面路由返回同一份界面入口，其余路径保持各自的错误响应", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pages-"));
  const config = {
    ...configured({ url: "http://127.0.0.1:1/v1", key: "test", model: "gpt-6-luna" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "pages-test-access-token" },
  };
  const runtime = createServer({ p: paths({ AGENT_HOME: root }), config });
  const origin = await runtime.listen();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const status = async (route) => (await fetch(origin + route)).status;

  for (const route of [
    "/",
    "/login",
    "/settings",
    "/sessions/abc",
    "/logs",
    "/logs/overview",
    "/logs/session/abc",
    "/logs/task/abc",
    "/notes",
    "/notes/abc",
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type"), /^text\/html/, route);
  }
  for (const route of [
    "/settings/extra",
    "/sessions",
    "/logs/session",
    "/logs/other/abc",
    "/logs/overview/abc",
    "/logs/session/abc/extra",
    "/notes/abc/extra",
    "/log",
  ]) {
    assert.equal(await status(route), 404, route);
  }
});
