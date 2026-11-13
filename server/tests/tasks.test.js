import { configured, selectedInput } from "./config-fixture.js";
import { startReply, runReply } from "./events.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "../index.js";
import { paths, saveConfig } from "../config.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";
import runTool from "../agent/runner.js";
import { createTaskManager } from "../tasks.js";
import ask from "../scripts/ask.js";
import { spawn } from "node:child_process";

const usage = { input_tokens: 100, output_tokens: 10, total_tokens: 110 };
const answer = (text) => ({ output: [message(text, "output_text", "assistant")], usage });
const call = (id, args) => ({
  type: "function_call",
  call_id: id,
  name: "agent",
  arguments: JSON.stringify(args),
});

async function fixture(t, respond) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-tasks-"));
  const p = paths({ AGENT_HOME: root });
  const url = await modelServer(t, respond);
  const config = {
    ...configured({ url, key: "test", model: "gpt-6.1-terra" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "task-test-access-token" },
  };
  config.models.push({ ...config.models[0], id: "sub", name: "子任务模型", model: "gpt-6-luna" });
  const runtime = createServer({ p, config });
  const origin = await runtime.listen();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const headers = {
    authorization: `Bearer ${config.api.token}`,
    "content-type": "application/json",
  };
  const request = (url, method = "GET", data) =>
    fetch(origin + url, {
      method,
      headers,
      ...(data === undefined
        ? {}
        : {
            body: JSON.stringify(
              method === "POST" && (url.endsWith("/messages") || url === "/api/tasks")
                ? selectedInput(data)
                : data,
            ),
          }),
    });
  const session = await (await request("/api/sessions", "POST", {})).json();
  return { root, p, config, runtime, request, session };
}

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) {
      return;
    }
    await delay(10);
  }
  assert.fail("等待任务状态超时");
}

test("两个子任务并发，主 Agent 可继续工作，结果自动交回且消息与计费独立", async (t) => {
  let started = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let mainRequests = 0;
  const inherited = [];
  const f = await fixture(t, async (request) => {
    const last = request.input.findLast((item) => item.type === "message" && item.role === "user")
      .content[0].text;
    if (last.startsWith("child-")) {
      started++;
      assert.equal(request.model, "gpt-6-luna");
      assert.ok(request.input[0].content[0].text.includes("main"));
      assert.equal(
        request.input.some((item) => item.type === "function_call"),
        false,
      );
      inherited.push(request.input[0]);
      await barrier;
      return answer(last.startsWith("child-A") ? "CHILD-A-RESULT" : "CHILD-B-RESULT");
    }
    mainRequests++;
    if (mainRequests === 1) {
      return {
        output: [
          call("start-a", {
            action: "start",
            task: "child-A",
            model_id: "sub",
            context: "fork",
          }),
          call("start-b", {
            action: "start",
            task: "child-B",
            model_id: "sub",
            context: "fork",
          }),
        ],
        usage,
      };
    }
    if (mainRequests === 2) {
      const outputs = request.input.filter((item) => item.type === "function_call_output");
      assert.equal(outputs.length, 2);
      for (const output of outputs) {
        const result = JSON.parse(JSON.parse(output.output).text);
        assert.equal(result.status, "running");
        assert.ok(result.task_id);
      }
      return {
        output: [
          {
            type: "function_call",
            name: "write",
            call_id: "parent-work",
            arguments: '{"path":"main.txt","content":"parent continued"}',
          },
        ],
        usage,
      };
    }
    assert.equal(started, 2);
    assert.equal(await fs.readFile(path.join(f.root, "main.txt"), "utf8"), "parent continued");
    release();
    return answer("主任务汇总");
  });
  const response = await startReply(f.request, `/api/sessions/${f.session.id}/messages`, {
    text: "main",
  });
  const list = await response.events;
  assert.equal(
    list.at(-1).status,
    "completed",
    JSON.stringify(list.filter((e) => e.type === "error")),
  );
  assert.equal(inherited.length, 2);
  assert.deepEqual(inherited[0], inherited[1]);
  const tasks = (await (await f.request(`/api/tasks?session_id=${f.session.id}`)).json()).tasks;
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((task) => task.status === "completed" && task.delivered_at));
  const total = await (await f.request(`/api/sessions/${f.session.id}`)).json();
  assert.equal(total.cost.amount, (mainRequests * 150000 + 30000) / 1e9);
  assert.equal(total.request_count, mainRequests + 2);
  const root = (await (await f.request(`/api/sessions/${f.session.id}/messages`)).json()).messages;
  assert.ok(root.every((row) => row.task_id === null));
  assert.equal(root.filter((row) => row.item.role === "user" && !row.meta?.task_results).length, 1);
  const handoffs = root.filter((row) => row.meta?.task_results);
  assert.deepEqual(
    handoffs.flatMap((row) => row.meta.task_results).sort(),
    tasks.map((task) => task.id).sort(),
  );
  assert.equal(list.flatMap((e) => e.saved || []).length, root.length);
  for (const task of tasks) {
    assert.equal(task.cost.amount, 0.000015);
    assert.equal(task.request_count, 1);
    const page = await (await f.request(`/api/tasks/${task.id}/messages`)).json();
    assert.ok(page.messages.every((row) => row.task_id === task.id && row.session_id === null));
    const copied = page.messages.filter((row) => row.meta?.inherited);
    assert.ok(copied.length > 0);
    assert.ok(copied.every((row) => row.usage === null && row.metering === null));
    assert.equal(page.messages.filter((row) => row.usage).length, 1);
    assert.equal(
      (await (await f.request(`/api/tasks/${task.id}/compactions`)).json()).compactions.length,
      0,
    );
  }
  assert.equal((await (await f.request("/api/sessions")).json()).sessions.length, 1);
  assert.equal((await f.request(`/api/sessions/${f.session.id}`, "DELETE")).status, 200);
  for (const table of ["tasks", "messages", "metering"]) {
    assert.equal(f.runtime.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  }
});

test("API 启动、状态、等待和取消；取消不会保存半轮输出", async (t) => {
  let modelStarted = false;
  const f = await fixture(t, async (_request, _emit, signal) => {
    modelStarted = true;
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return answer("不应保存");
  });
  const response = await f.request("/api/tasks", "POST", {
    session_id: f.session.id,
    task: "long task",
  });
  assert.equal(response.status, 201);
  const task = await response.json();
  await until(() => modelStarted);
  const manager = createTaskManager(f.runtime.db, f.p);
  t.after(() => manager.close());
  const scope = { sessionId: f.session.id, modelId: "main", compactModelId: "compact", manager };
  const status = await runTool(
    call("query", { action: "status", task_id: task.task_id }),
    f.config,
    undefined,
    scope,
  );
  assert.equal(JSON.parse(status.text).status, "running");
  const waited = await runTool(
    call("wait", { action: "wait", task_id: task.task_id, seconds: 0 }),
    f.config,
    undefined,
    scope,
  );
  assert.equal(JSON.parse(waited.text).status, "running");
  const denied = await runTool(
    call("denied", { action: "status", task_id: task.task_id }),
    f.config,
    undefined,
    { ...scope, sessionId: "other" },
  );
  assert.equal(denied.failed, true);
  const cancelled = await f.request(`/api/tasks/${task.task_id}/cancel`, "POST", {});
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).status, "cancelled");
  const history = (await (await f.request(`/api/tasks/${task.task_id}/messages`)).json()).messages;
  assert.equal(history.length, 1);
  assert.equal(history[0].item.role, "user");
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM metering").get().n, 0);
  assert.equal((await f.request("/api/tasks/missing")).status, 404);
  assert.equal((await f.request(`/api/tasks/${task.task_id}/messages`, "POST", {})).status, 405);
});

test("子任务失败也交回主模型；已交付结果不在下一轮重复注入", async (t) => {
  let calls = 0;
  let taskFailed = false;
  const f = await fixture(t, (request) => {
    const last = request.input.findLast((item) => item.type === "message" && item.role === "user")
      .content[0].text;
    if (last.startsWith("FAIL-CHILD")) {
      taskFailed = true;
      return {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      };
    }
    calls++;
    if (calls === 1) {
      return { output: [call("child", { action: "start", task: "FAIL-CHILD" })], usage };
    }
    return answer("已处理失败");
  });
  const first = await runReply(f.request, `/api/sessions/${f.session.id}/messages`, {
    text: "start",
  });
  assert.equal(first.at(-1).status, "completed");
  assert.equal(taskFailed, true);
  assert.ok(first.some((e) => e.meta?.task_results && e.item?.role === "user"));
  const before = f.runtime.db
    .prepare("SELECT COUNT(*) n FROM messages WHERE json_type(meta, '$.task_results') = 'array'")
    .get().n;
  const next = await runReply(f.request, `/api/sessions/${f.session.id}/messages`, {
    text: "继续",
  });
  assert.equal(next.at(-1).status, "completed");
  const after = f.runtime.db
    .prepare("SELECT COUNT(*) n FROM messages WHERE json_type(meta, '$.task_results') = 'array'")
    .get().n;
  assert.equal(after, before);
});

test("CLI 同样能委派子任务并接收结果，进程结束前清理任务", async (t) => {
  let root = 0;
  const f = await fixture(t, (request) => {
    const last = request.input.findLast((item) => item.type === "message" && item.role === "user")
      .content[0].text;
    if (last.startsWith("CLI-CHILD")) {
      return answer("子任务已完成");
    }
    root++;
    if (root === 1) {
      return { output: [call("cli-child", { action: "start", task: "CLI-CHILD" })], usage };
    }
    return answer("主任务已完成");
  });
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  let result;
  try {
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    result = await ask("CLI root", f.config, {
      locations: f.p,
      modelId: "main",
      compactModelId: "compact",
    });
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
  assert.equal(result.status, "completed");
  const tasks = f.runtime.db
    .prepare("SELECT * FROM tasks WHERE session_id = ?")
    .all(result.session_id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "completed");
  assert.ok(tasks[0].delivered_at);
});

test("显式 wait 的结果只作为一次工具返回，自动交接不重复发送", async (t) => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let root = 0;
  const f = await fixture(t, async (request) => {
    const first = request.input[0].content[0].text;
    if (first.startsWith("WAIT-CHILD")) {
      await barrier;
      return answer("等待结果");
    }
    root++;
    if (root === 1) {
      return { output: [call("start", { action: "start", task: "WAIT-CHILD" })], usage };
    }
    if (root === 2) {
      const output = request.input.find((item) => item.type === "function_call_output");
      const id = JSON.parse(JSON.parse(output.output).text).task_id;
      release();
      return { output: [call("wait-result", { action: "wait", task_id: id, seconds: 10 })], usage };
    }
    return answer("已收取结果");
  });
  const list = await runReply(f.request, `/api/sessions/${f.session.id}/messages`, {
    text: "main",
  });
  assert.equal(list.at(-1).status, "completed");
  assert.equal(
    list.some((event) => event.item?.role === "user" && event.meta?.task_results),
    false,
  );
  const delivered = list.filter(
    (event) => event.type === "function_call_output" && event.meta?.task_results,
  );
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].item.call_id, "wait-result");
  assert.ok(delivered[0].item.output.includes("等待结果"));
});

test("停止主会话会取消子任务，已保存工具轮次保留，done 只发送一次", async (t) => {
  let childStarted = false;
  let calls = 0;
  const f = await fixture(t, async (request, _emit, signal) => {
    const first = request.input[0].content[0].text;
    if (first.startsWith("CANCEL-CHILD")) {
      childStarted = true;
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return answer("不应保存");
    }
    calls++;
    if (calls === 1) {
      return { output: [call("child", { action: "start", task: "CANCEL-CHILD" })], usage };
    }
    return answer("父任务等候");
  });
  const response = await startReply(f.request, `/api/sessions/${f.session.id}/messages`, {
    text: "main",
  });
  const text = response.events;
  await until(() => childStarted);
  assert.equal((await f.request(`/api/sessions/${f.session.id}/cancel`, "POST", {})).status, 200);
  const list = await text;
  assert.equal(list.filter((event) => event.type === "done").length, 1);
  assert.equal(list.at(-1).status, "aborted");
  const child = f.runtime.db.prepare("SELECT * FROM tasks").get();
  assert.equal(child.status, "cancelled");
  assert.equal(
    f.runtime.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id = ?").get(child.id).n,
    1,
  );
});

test("任务压缩和费用也归属任务；不出现在主会话的消息与压缩记录中", async (t) => {
  let rounds = 0;
  const f = await fixture(t, (request) => {
    if (request.tools.length === 0) {
      return answer("任务历史摘要");
    }
    rounds++;
    if (rounds < 3) {
      return {
        output: [
          {
            type: "function_call",
            name: "read",
            call_id: `read-${rounds}`,
            arguments: '{"path":"absent.txt"}',
          },
        ],
        usage,
      };
    }
    return answer("任务完成");
  });
  assert.equal(
    (
      await f.request("/api/config", "PUT", {
        compact_at: 10,
        keep: 1,
        models: f.config.models.map((model) =>
          model.id === "compact" ? { ...model, model: "gpt-6-luna" } : model,
        ),
      })
    ).status,
    200,
  );
  const created = await (
    await f.request("/api/tasks", "POST", { session_id: f.session.id, task: "compact child" })
  ).json();
  await until(
    () =>
      f.runtime.db.prepare("SELECT status FROM tasks WHERE id = ?").get(created.task_id).status ===
      "completed",
  );
  const summaries = (await (await f.request(`/api/tasks/${created.task_id}/compactions`)).json())
    .compactions;
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].task_id, created.task_id);
  assert.equal(summaries[0].session_id, null);
  assert.equal(summaries[0].metering.model, "gpt-6-luna");
  const info = await (await f.request(`/api/tasks/${created.task_id}`)).json();
  assert.equal(info.request_count, 4);
  assert.equal(info.cost.amount, 0.000465);
  assert.equal(
    f.runtime.db.prepare("SELECT total_cost_nanos FROM tasks WHERE id = ?").get(created.task_id)
      .total_cost_nanos,
    465000,
  );
  assert.equal(
    (await (await f.request(`/api/sessions/${f.session.id}`)).json()).cost.amount,
    info.cost.amount,
  );
  assert.equal(
    (await (await f.request(`/api/sessions/${f.session.id}/messages`)).json()).messages.length,
    0,
  );
  assert.equal(
    (await (await f.request(`/api/sessions/${f.session.id}/compactions`)).json()).compactions
      .length,
    0,
  );
});

test("嵌套任务结果交给直接父任务，达到三层后拒绝继续派生", async (t) => {
  const f = await fixture(t, (request) => {
    const first = request.input[0].content[0].text;
    const match = /^LEVEL-(\d)/.exec(first);
    const level = Number(match[1]);
    if (!request.input.some((item) => item.type === "function_call")) {
      return {
        output: [call(`start-${level}`, { action: "start", task: `LEVEL-${level + 1}` })],
        usage,
      };
    }
    return answer(`LEVEL-${level}-done`);
  });
  const created = await (
    await f.request("/api/tasks", "POST", { session_id: f.session.id, task: "LEVEL-1" })
  ).json();
  await until(
    () =>
      f.runtime.db.prepare("SELECT status FROM tasks WHERE id = ?").get(created.task_id).status ===
      "completed",
  );
  const tasks = f.runtime.db.prepare("SELECT * FROM tasks ORDER BY created_at").all();
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].parent_task_id, null);
  assert.equal(tasks[1].parent_task_id, tasks[0].id);
  assert.equal(tasks[2].parent_task_id, tasks[1].id);
  assert.ok(tasks.slice(1).every((task) => task.delivered_at));
  const failedTool = f.runtime.db
    .prepare(
      "SELECT item FROM messages WHERE task_id = ? AND json_extract(item, '$.type') = 'function_call_output'",
    )
    .get(tasks[2].id);
  assert.ok(failedTool.item.includes("最多嵌套 3 层"));
});

test("每会话最多八个并发任务，停止会话也会取消通过 API 单独创建的任务", async (t) => {
  let started = 0;
  const f = await fixture(t, async (_request, _emit, signal) => {
    started++;
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return answer("取消后不保存");
  });
  for (let i = 0; i < 8; i++) {
    assert.equal(
      (await f.request("/api/tasks", "POST", { session_id: f.session.id, task: `pending-${i}` }))
        .status,
      201,
    );
  }
  await until(() => started === 8);
  const ninth = await f.request("/api/tasks", "POST", { session_id: f.session.id, task: "ninth" });
  assert.equal(ninth.status, 400);
  assert.ok((await ninth.json()).error.includes("8 个"));
  assert.equal((await f.request(`/api/sessions/${f.session.id}/cancel`, "POST", {})).status, 200);
  const rows = f.runtime.db.prepare("SELECT status FROM tasks").all();
  assert.equal(rows.length, 8);
  assert.ok(rows.every((row) => row.status === "cancelled"));
});

test("任务独立超时，失去执行进程的任务标记为中断", async (t) => {
  const f = await fixture(t, async (_request, _emit, signal) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return answer("超时后不保存");
  });
  assert.equal((await f.request("/api/config", "PUT", { run_timeout: 1 })).status, 200);
  const task = await (
    await f.request("/api/tasks", "POST", { session_id: f.session.id, task: "timeout task" })
  ).json();
  await until(
    () =>
      f.runtime.db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.task_id).status ===
      "failed",
  );
  const timed = await (await f.request(`/api/tasks/${task.task_id}`)).json();
  assert.ok(timed.error.includes("超时"));
  assert.equal(timed.request_count, 0);
  f.runtime.db
    .prepare(
      "INSERT INTO tasks (id, session_id, status, worker_pid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("lost-worker", f.session.id, "running", 99999999, Date.now(), Date.now());
  const lost = await (await f.request("/api/tasks/lost-worker")).json();
  assert.equal(lost.status, "interrupted");
  assert.ok(lost.completed_at);
});

test("父任务失败时先停止后代，再公布终态", async (t) => {
  let childStarted = false;
  const f = await fixture(t, async (request, _emit, signal) => {
    const first = request.input[0].content[0].text;
    if (first.startsWith("STALLED-DESCENDANT")) {
      childStarted = true;
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return answer("不应保存");
    }
    if (!request.input.some((item) => item.type === "function_call")) {
      return { output: [call("nested", { action: "start", task: "STALLED-DESCENDANT" })], usage };
    }
    await until(() => childStarted);
    return {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
    };
  });
  const task = await (
    await f.request("/api/tasks", "POST", { session_id: f.session.id, task: "failing parent" })
  ).json();
  await until(
    () =>
      f.runtime.db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.task_id).status ===
      "failed",
  );
  const descendants = f.runtime.db
    .prepare("SELECT status FROM tasks WHERE parent_task_id = ?")
    .all(task.task_id);
  assert.deepEqual(
    descendants.map((row) => row.status),
    ["cancelled"],
  );
});

test("CLI 收到 SIGINT 时终止主运行与子任务并保存终态", async (t) => {
  let childStarted = false;
  const f = await fixture(t, async (request, _emit, signal) => {
    const first = request.input[0].content[0].text;
    if (first.startsWith("SIGNAL-CHILD")) {
      childStarted = true;
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return answer("不应保存");
    }
    if (!request.input.some((item) => item.type === "function_call")) {
      return { output: [call("signal-child", { action: "start", task: "SIGNAL-CHILD" })], usage };
    }
    return answer("父任务等待");
  });
  saveConfig(f.p, f.config);
  const child = spawn(
    process.execPath,
    [
      path.resolve("server/scripts/cli.js"),
      "ask",
      "--model",
      "main",
      "--compact-model",
      "compact",
      "signal parent",
    ],
    { env: { ...process.env, AGENT_HOME: f.root }, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.resume();
  child.stderr.resume();
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });
  await until(() => childStarted);
  child.kill("SIGINT");
  const result = await exited;
  assert.equal(result.signal, null);
  const tasks = f.runtime.db.prepare("SELECT status FROM tasks").all();
  assert.deepEqual(
    tasks.map((task) => task.status),
    ["cancelled"],
  );
});
