import { configured } from "./config-fixture.js";
import { connectEvents } from "./events.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../index.js";
import { paths } from "../config.js";
import { message } from "../ai/index.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pinned-"));
  const p = paths({ AGENT_HOME: root });
  const config = {
    ...configured({ url: "http://127.0.0.1:1/v1", key: "test", model: "gpt-6-luna" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "pinned-test-access-token" },
  };
  const runtime = createServer({ p, config });
  const origin = await runtime.listen();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (url, method = "GET", data) =>
    fetch(origin + url, {
      method,
      headers: { authorization: "Bearer " + config.api.token, "content-type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  // 每个会话的 updated_at 递增，方便断言「置顶之外按最近活动排序」。
  let clock = 1000;
  const create = async (title) => {
    const session = await (await request("/api/sessions", "POST", { title })).json();
    clock += 1000;
    runtime.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(clock, session.id);
    return session.id;
  };
  const list = async () => (await (await request("/api/sessions")).json()).sessions;
  const titles = async () => (await list()).map((session) => session.title);
  return { runtime, request, create, list, titles };
}

test("置顶后排到最前，新置顶在已置顶之上，其余按最近活动排序，取消后回到活动顺序", async (t) => {
  const f = await fixture(t);
  const a = await f.create("A");
  await f.create("B");
  const c = await f.create("C");
  await f.create("D");
  assert.deepEqual(await f.titles(), ["D", "C", "B", "A"]);
  assert.equal((await f.list())[0].pinned, null);

  const pinnedA = await (await f.request(`/api/sessions/${a}`, "PATCH", { pinned: true })).json();
  assert.equal(typeof pinnedA.pinned, "number");
  assert.deepEqual(await f.titles(), ["A", "D", "C", "B"]);
  await f.request(`/api/sessions/${c}`, "PATCH", { pinned: true });
  assert.deepEqual(await f.titles(), ["C", "A", "D", "B"]);
  // 重复置顶不改变顺序。
  await f.request(`/api/sessions/${a}`, "PATCH", { pinned: true });
  assert.deepEqual(await f.titles(), ["C", "A", "D", "B"]);

  const unpinned = await (await f.request(`/api/sessions/${c}`, "PATCH", { pinned: false })).json();
  assert.equal(unpinned.pinned, null);
  assert.deepEqual(await f.titles(), ["A", "D", "C", "B"]);
});

test("置顶不改变活动时间；标题与置顶可同时修改；非法请求被拒绝，未知会话返回 404", async (t) => {
  const f = await fixture(t);
  const id = await f.create("原标题");
  const before = (await f.list())[0].updated_at;
  const result = await (
    await f.request(`/api/sessions/${id}`, "PATCH", { title: "新标题", pinned: true })
  ).json();
  assert.equal(result.title, "新标题");
  assert.equal(typeof result.pinned, "number");
  assert.equal(result.updated_at, before);

  assert.equal((await f.request(`/api/sessions/${id}`, "PATCH", {})).status, 400);
  assert.equal((await f.request(`/api/sessions/${id}`, "PATCH", { pinned: "yes" })).status, 400);
  assert.equal((await f.request(`/api/sessions/${id}`, "PATCH", { pinned: 1 })).status, 400);
  assert.equal((await f.request(`/api/sessions/${id}`, "PATCH", { order: 1 })).status, 400);
  assert.equal((await f.request("/api/sessions/missing", "PATCH", { pinned: true })).status, 404);
  assert.equal((await f.list())[0].title, "新标题");
});

test("批量排序一次设定整个置顶组：调整顺序、拖入置顶、拖出取消，不在列表里的取消置顶", async (t) => {
  const f = await fixture(t);
  const a = await f.create("A");
  const b = await f.create("B");
  const c = await f.create("C");
  await f.create("D");

  const first = await f.request("/api/sessions/pinned", "PUT", { ids: [b, a] });
  assert.equal(first.status, 200);
  assert.deepEqual(
    (await first.json()).sessions.map((session) => session.title),
    ["B", "A", "D", "C"],
  );
  assert.deepEqual(await f.titles(), ["B", "A", "D", "C"]);

  // 拖入：C 插到中间；拖动排序：A 移到最前。
  await f.request("/api/sessions/pinned", "PUT", { ids: [b, c, a] });
  assert.deepEqual(await f.titles(), ["B", "C", "A", "D"]);
  await f.request("/api/sessions/pinned", "PUT", { ids: [a, b, c] });
  assert.deepEqual(await f.titles(), ["A", "B", "C", "D"]);

  // 拖出：列表里没有 B，B 取消置顶并回到活动顺序。
  await f.request("/api/sessions/pinned", "PUT", { ids: [a, c] });
  assert.deepEqual(await f.titles(), ["A", "C", "D", "B"]);
  const pins = (await f.list()).map((session) => session.pinned);
  assert.deepEqual(pins, [0, 1, null, null]);

  // 空列表取消全部置顶。
  await f.request("/api/sessions/pinned", "PUT", { ids: [] });
  assert.deepEqual(await f.titles(), ["D", "C", "B", "A"]);
});

test("批量排序拒绝非法输入，失败时已有置顶保持不变", async (t) => {
  const f = await fixture(t);
  const a = await f.create("A");
  const b = await f.create("B");
  await f.request("/api/sessions/pinned", "PUT", { ids: [a, b] });
  const snapshot = await f.titles();

  assert.equal((await f.request("/api/sessions/pinned", "PUT", { ids: "x" })).status, 400);
  assert.equal((await f.request("/api/sessions/pinned", "PUT", { ids: [a, a] })).status, 400);
  assert.equal((await f.request("/api/sessions/pinned", "PUT", { ids: [1] })).status, 400);
  assert.equal((await f.request("/api/sessions/pinned", "PUT", {})).status, 400);
  assert.equal((await f.request("/api/sessions/pinned", "PUT", { ids: [], x: 1 })).status, 400);
  assert.equal(
    (await f.request("/api/sessions/pinned", "PUT", { ids: [a, "missing"] })).status,
    404,
  );
  assert.equal((await f.request("/api/sessions/pinned", "GET")).status, 405);
  assert.equal((await f.request("/api/sessions/pinned/extra", "PUT", { ids: [] })).status, 404);
  assert.deepEqual(await f.titles(), snapshot);
});

test("置顶变化通过全局流同步，只推送状态真正变化的会话，快照按置顶排序", async (t) => {
  const f = await fixture(t);
  const a = await f.create("A");
  const b = await f.create("B");
  const c = await f.create("C");
  await f.request("/api/sessions/pinned", "PUT", { ids: [a, b] });

  const stream = await connectEvents(f.request);
  t.after(() => stream.close());
  const snapshot = stream.frames.find((frame) => frame.snapshot);
  assert.deepEqual(
    snapshot.snapshot.sessions.map((session) => session.title),
    ["A", "B", "C"],
  );

  // 只把 C 拖入末尾：A、B 的置顶值不变，不重复推送。
  await f.request("/api/sessions/pinned", "PUT", { ids: [a, b, c] });
  await stream.waitFor((frame) => frame.session?.id === c && frame.session.pinned === 2);
  assert.equal(
    stream.frames.filter((frame) => frame.session?.id === a || frame.session?.id === b).length,
    0,
  );

  await f.request(`/api/sessions/${b}`, "PATCH", { pinned: false });
  await stream.waitFor((frame) => frame.session?.id === b && frame.session.pinned === null);
});

test("删除置顶会话不影响其他置顶；分支不继承置顶", async (t) => {
  const f = await fixture(t);
  const a = await f.create("A");
  const b = await f.create("B");
  await f.request("/api/sessions/pinned", "PUT", { ids: [a, b] });
  f.runtime.db
    .prepare("INSERT INTO messages (session_id, item, created_at) VALUES (?, ?, ?)")
    .run(a, JSON.stringify(message("回答", "output_text", "assistant")), Date.now());
  const last = f.runtime.db.prepare("SELECT MAX(id) id FROM messages").get().id;
  const branch = await (
    await f.request(`/api/sessions/${a}/branches`, "POST", { message_id: last })
  ).json();
  assert.equal(branch.pinned ?? null, null);

  assert.equal((await f.request(`/api/sessions/${a}`, "DELETE")).status, 200);
  const rest = await f.list();
  assert.deepEqual(
    rest.map((session) => [session.id, session.pinned]),
    [
      [b, 1],
      [branch.id, null],
    ],
  );
});
