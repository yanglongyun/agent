import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createServer } from "../index.js";
import { paths } from "../config.js";
import { configured } from "./config-fixture.js";
import modelServer from "./model.js";
import { message } from "../ai/index.js";
import { runReply } from "./events.js";

async function fixture(t, models, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-models-"));
  const locations = paths({ AGENT_HOME: root });
  const config = configured(
    {},
    {
      models,
      api: { listen: "127.0.0.1:0", token: "model-list-test-token" },
      ...options,
    },
  );
  const runtime = createServer({ p: locations, config });
  const base = await runtime.listen();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (route, method = "GET", data) =>
    fetch(base + route, {
      method,
      headers: { Authorization: "Bearer " + config.api.token, "content-type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const id = (await (await request("/api/sessions", "POST", {})).json()).id;
  return { locations, runtime, request, id };
}

function connection(id, url, protocol = "responses") {
  return { id, name: id, model: id, url, key: id + "-key", protocol, context_window: 0 };
}

test("模型列表增删改按标识保留密钥，状态与设置不回显密钥，列表不分配用途", async (t) => {
  const f = await fixture(t, [
    connection("first", "https://first.invalid/responses"),
    connection("second", "https://second.invalid/messages", "anthropic-messages"),
  ]);
  const view = await (await f.request("/api/config")).json();
  assert.ok(view.models.every((model) => model.key === undefined && model.key_set));
  const status = await (await f.request("/api/status")).json();
  assert.equal(JSON.stringify(status).includes("first-key"), false);
  assert.equal(JSON.stringify(status).includes("second-key"), false);
  const models = view.models.toReversed().map(({ key_set, ...model }) => ({ ...model, key: "" }));
  models[0].name = "edited";
  const third = connection("third", "https://third.invalid/chat", "chat-completions");
  assert.equal(
    (
      await f.request("/api/config", "PUT", {
        models: [...models, third],
      })
    ).status,
    200,
  );
  const saved = JSON.parse(await fs.readFile(f.locations.config, "utf8"));
  assert.deepEqual(
    saved.models.map((model) => [model.id, model.key]),
    [
      ["second", "second-key"],
      ["first", "first-key"],
      ["third", "third-key"],
    ],
  );
  assert.equal(
    (
      await f.request("/api/config", "PUT", {
        models: [saved.models[1]],
      })
    ).status,
    200,
  );
  const updated = await (await f.request("/api/config")).json();
  assert.equal(updated.models.length, 1);
  assert.equal(updated.default_model, undefined);
  assert.equal(updated.compact_model, undefined);
  assert.equal(
    (
      await f.request("/api/config", "PUT", {
        models: [connection("empty", "https://empty.invalid"), { ...third, id: "new", key: "" }],
      })
    ).status,
    400,
  );
});

test("每条消息固定所选连接，未知选择不写用户消息；子 Agent 可使用独立 Chat 协议", async (t) => {
  const childRequests = [];
  const child = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
    }
    const body = JSON.parse(raw);
    childRequests.push({ body, key: req.headers.authorization });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ id: "chat-child", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "子任务完成" }, finish_reason: null }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ id: "chat-child", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => child.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    child.closeAllConnections();
    child.close();
  });
  let mainRequests = 0;
  const call = (id, args) => ({
    type: "function_call",
    call_id: id,
    name: "agent",
    arguments: JSON.stringify(args),
  });
  const mainURL = await modelServer(t, (body) => {
    mainRequests++;
    assert.equal(body.model, "main");
    if (mainRequests === 1) {
      return { output: [call("discover", { action: "models" })] };
    }
    if (mainRequests === 2) {
      const data = JSON.stringify(body.input);
      assert.ok(data.includes("child"));
      assert.equal(data.includes("child-key"), false);
      return { output: [call("start", { action: "start", task: "独立执行", model_id: "child" })] };
    }
    if (mainRequests === 3) {
      const output = body.input.find(
        (item) => item.type === "function_call_output" && item.call_id === "start",
      );
      const taskId = JSON.parse(JSON.parse(output.output).text).task_id;
      return { output: [call("wait", { action: "wait", task_id: taskId, seconds: 30 })] };
    }
    return {
      output: [message("主任务完成", "output_text", "assistant")],
      usage: { total_tokens: 10 },
    };
  });
  const f = await fixture(t, [
    connection("main", mainURL),
    connection("child", `http://127.0.0.1:${child.address().port}`, "chat-completions"),
  ]);
  assert.equal(
    (
      await f.request(`/api/sessions/${f.id}/messages`, "POST", {
        text: "无效",
        model_id: "missing",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request(`/api/sessions/${f.id}/messages`, "POST", { text: "缺少选择" })).status,
    400,
  );
  assert.equal(
    (
      await f.request(`/api/sessions/${f.id}/messages`, "POST", {
        text: "缺少压缩",
        model_id: "main",
      })
    ).status,
    400,
  );
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
  const events = await runReply(f.request, `/api/sessions/${f.id}/messages`, {
    text: "执行任务",
    model_id: "main",
    compact_model_id: "main",
  });
  assert.equal(events.at(-1).status, "completed");
  assert.equal(mainRequests, 4);
  assert.equal(childRequests.length, 1);
  assert.equal(childRequests[0].key, "Bearer child-key");
  assert.equal(childRequests[0].body.model, "child");
  assert.ok(Array.isArray(childRequests[0].body.messages));
  const task = f.runtime.db.prepare("SELECT model,protocol,status FROM tasks").get();
  assert.equal(task.model, "child");
  assert.equal(task.protocol, "chat-completions");
  assert.equal(task.status, "completed");
  const first = f.runtime.db
    .prepare("SELECT meta FROM messages WHERE session_id = ? ORDER BY id LIMIT 1")
    .get(f.id);
  assert.equal(JSON.parse(first.meta).model_id, "main");
  assert.equal(JSON.parse(first.meta).compact_model_id, "main");
  const switched = await runReply(f.request, `/api/sessions/${f.id}/messages`, {
    text: "换模型",
    model_id: "child",
    compact_model_id: "main",
  });
  assert.equal(switched.at(-1).status, "completed");
  assert.equal(childRequests.length, 2);
  assert.equal(mainRequests, 4);
});
