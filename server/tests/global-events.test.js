import { configured, selectedInput } from "./config-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "../index.js";
import { paths } from "../config.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";
import { connectEvents, startReply } from "./events.js";

async function fixture(t, respond) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-global-events-"));
  const p = paths({ AGENT_HOME: root });
  const url = await modelServer(t, respond);
  const config = {
    ...configured({ url, key: "test", model: "gpt-6-luna" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "global-events-test-token" },
  };
  const runtime = createServer({ p, config });
  const origin = await runtime.listen();
  const request = (route, method = "GET", data) =>
    fetch(origin + route, {
      method,
      headers: { authorization: "Bearer " + config.api.token, "content-type": "application/json" },
      ...(data === undefined
        ? {}
        : {
            body: JSON.stringify(
              method === "POST" && (route.endsWith("/messages") || route === "/api/tasks")
                ? selectedInput(data)
                : data,
            ),
          }),
    });
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const create = async (title = "") =>
    (await (await request("/api/sessions", "POST", { title })).json()).id;
  return { runtime, origin, request, create };
}
const answer = (text) => ({
  output: [message(text, "output_text", "assistant")],
  usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
});

test("一条全局 SSE 复用八个并行会话，发送立即返回且停止请求不被占用", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = new Map();
  const f = await fixture(t, async (request, emit, signal) => {
    const text = request.input[0].content[0].text;
    calls.set(text, (calls.get(text) || 0) + 1);
    emit({ type: "message", delta: text + "进行中" });
    await Promise.race([
      gate,
      new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })),
    ]);
    return answer(text + "完成");
  });
  const stream = await connectEvents(f.request);
  t.after(() => stream.close());
  const ids = await Promise.all(Array.from({ length: 8 }, (_, index) => f.create(`并行${index}`)));
  const runs = await Promise.all(
    ids.map((id, index) =>
      startReply(f.request, `/api/sessions/${id}/messages`, { text: `任务${index}` }, stream),
    ),
  );
  for (const run of runs) {
    await stream.waitFor((frame) => frame.run_id === run.accepted.run_id && frame.event?.delta);
  }
  assert.equal(new Set(runs.map((run) => run.accepted.run_id)).size, 8);
  assert.equal(calls.size, 8);
  assert.ok([...calls.values()].every((count) => count === 1));
  assert.equal(
    (await (await f.request("/api/sessions")).json()).sessions.filter((session) => session.running)
      .length,
    8,
  );
  assert.equal(
    (await f.request(`/api/sessions/${ids[0]}/messages`, "POST", { text: "重复" })).status,
    409,
  );
  assert.equal((await f.request(`/api/sessions/${ids[0]}/cancel`, "POST", {})).status, 200);
  assert.equal((await runs[0].events).at(-1).status, "aborted");
  // done 结束一个会话的回复，不能关闭全局流；其余会话继续推送。
  release();
  const completed = await Promise.all(runs.slice(1).map((run) => run.events));
  assert.ok(completed.every((events) => events.at(-1).status === "completed"));
  assert.ok(completed.every((events) => events.at(-1).session.request_count === 1));
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM metering").get().n, 7);
  const cursor = stream.frames.map((frame) => frame.cursor);
  assert.ok(cursor.every((value, index) => index === 0 || value > cursor[index - 1]));
  const newId = await f.create("流仍然可用");
  await stream.waitFor((frame) => frame.session?.id === newId);
});

test("断开全局流不停止生成，重连快照与历史游标恢复片段且不重复计费", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let signal;
  const f = await fixture(t, async (_request, emit, currentSignal) => {
    calls++;
    signal = currentSignal;
    emit({ type: "message", delta: "正在" });
    emit({ type: "message", delta: "生成" });
    await gate;
    return answer("生成完成");
  });
  const first = await connectEvents(f.request);
  const id = await f.create("恢复");
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", { text: "工作" });
  assert.equal(response.status, 202);
  const accepted = await response.json();
  await first.waitFor((frame) => frame.run_id === accepted.run_id && frame.event?.delta === "生成");
  await first.close();
  await delay(20);
  assert.equal(signal.aborted, false);
  const second = await connectEvents(f.request);
  t.after(() => second.close());
  const snapshot = second.frames[0];
  assert.equal(snapshot.snapshot.sessions.find((session) => session.id === id).running, true);
  const page = await (await f.request(`/api/sessions/${id}/messages`)).json();
  assert.equal(page.epoch, snapshot.epoch);
  assert.ok(page.cursor >= snapshot.cursor);
  assert.equal(page.run_id, accepted.run_id);
  assert.equal(page.messages.length, 1);
  assert.deepEqual(
    page.pending.map((event) => event.delta),
    ["正在生成"],
  );
  release();
  const terminal = await second.waitFor(
    (frame) => frame.run_id === accepted.run_id && frame.event?.type === "done",
  );
  assert.ok(terminal.cursor > page.cursor);
  assert.equal(terminal.event.status, "completed");
  assert.equal(terminal.event.session.request_count, 1);
  assert.equal(calls, 1);
  const final = await (await f.request(`/api/sessions/${id}/messages`)).json();
  assert.equal(final.messages.length, 2);
  assert.deepEqual(final.pending, []);
  assert.equal(final.reply_result.status, "completed");
});

test("后台失败和会话新增改名分支删除均通过全局流同步，旧逐会话订阅已删除", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("上游暂时不可用");
  });
  const stream = await connectEvents(f.request);
  t.after(() => stream.close());
  const id = await f.create("原名称");
  await stream.waitFor((frame) => frame.session?.id === id);
  await f.request(`/api/sessions/${id}`, "PATCH", { title: "新名称" });
  await stream.waitFor((frame) => frame.session?.title === "新名称");
  const run = await startReply(f.request, `/api/sessions/${id}/messages`, { text: "请求" }, stream);
  assert.equal((await run.events).at(-1).status, "incomplete");
  const page = await (await f.request(`/api/sessions/${id}/messages`)).json();
  assert.match(page.reply_result.error, /上游暂时不可用/);
  f.runtime.db
    .prepare("INSERT INTO messages (session_id, item, created_at) VALUES (?, ?, ?)")
    .run(id, JSON.stringify(message("已有回答", "output_text", "assistant")), Date.now());
  const last = f.runtime.db
    .prepare("SELECT MAX(id) id FROM messages WHERE session_id = ?")
    .get(id).id;
  const branch = await (
    await f.request(`/api/sessions/${id}/branches`, "POST", { message_id: last })
  ).json();
  await stream.waitFor((frame) => frame.session?.id === branch.id);
  await f.request(`/api/sessions/${branch.id}`, "DELETE");
  await stream.waitFor((frame) => frame.deleted_session_id === branch.id);
  assert.equal((await f.request(`/api/sessions/${id}/events`)).status, 404);
  assert.equal((await f.request("/api/events", "POST", {})).status, 405);
  assert.equal((await f.request("/api/events/extra")).status, 404);
  assert.equal((await fetch(f.origin + "/api/events")).status, 401);
});
