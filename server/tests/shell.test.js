import { configured, selectedInput } from "./config-fixture.js";
import { runReply } from "./events.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import openDB from "../db.js";
import { createShellManager } from "../shell.js";
import { createSession } from "../session.js";
import { createServer } from "../index.js";
import { defaults, paths } from "../config.js";
import runTool from "../agent/runner.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";
import ask from "../scripts/ask.js";

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const node = (source) => quote(process.execPath) + " -e " + quote(source);
const shellCall = (args) => ({
  name: "shell",
  call_id: "shell-call",
  arguments: JSON.stringify(args),
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-shell-"));
  const db = openDB(path.join(root, "agent.db"));
  const manager = createShellManager(db);
  const session = createSession(db);
  const config = { ...defaults(), workdir: root };
  const scope = { sessionId: session.id };
  t.after(async () => {
    await manager.close();
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, db, manager, config, scope };
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) {
      return;
    }
    await delay(10);
  }
  assert.fail("等待命令状态超时");
}

test("后台命令立即返回；stdio 写入、读取、EOF 和等待复用同一条持久记录", async (t) => {
  const f = await fixture(t);
  const context = { ...f.scope, manager: { shell: f.manager } };
  const started = await runTool(
    shellCall({
      background: true,
      command: node(
        "process.stdout.write('ready\\n');process.stdin.setEncoding('utf8');process.stdin.on('data',s=>process.stdout.write(s));process.stdin.on('end',()=>process.exit(0));",
      ),
    }),
    f.config,
    undefined,
    context,
  );
  const id = JSON.parse(started.text).process_id;
  assert.ok(id);
  assert.equal(f.manager.info(id, f.scope).status, "running");
  await until(() => f.manager.info(id, f.scope).output.includes("ready"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.manager.wait(id, f.scope, controller.signal), { name: "AbortError" });
  assert.equal(f.manager.info(id, f.scope).status, "running");
  await f.manager.stdio({ process_id: id, action: "write", input: "中文输入\n" }, f.scope);
  await until(() => f.manager.info(id, f.scope).output.includes("中文输入"));
  const read = await runTool(
    { name: "stdio", arguments: JSON.stringify({ process_id: id, action: "read" }) },
    f.config,
    undefined,
    context,
  );
  assert.match(JSON.parse(read.text).output, /中文输入/);
  await f.manager.stdio({ process_id: id, action: "close" }, f.scope);
  const done = await f.manager.wait(id, f.scope, undefined, 2);
  assert.equal(done.status, "completed");
  assert.equal(done.exit_code, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM shell_jobs").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM metering").get().n, 0);
  await assert.rejects(
    f.manager.stdio({ process_id: id, action: "write", input: "x" }, f.scope),
    /管道已关闭/,
  );
  assert.throws(() => f.manager.info(id, { sessionId: "other" }), /不属于/);
  assert.throws(() => f.manager.info(id, { ...f.scope, taskId: "other" }), /只能访问/);
  await assert.rejects(f.manager.wait(id, f.scope, undefined, 61), /0 到 60/);
});

test("后台输出保留末尾并标记截断，非零退出与启动失败持久化", async (t) => {
  const f = await fixture(t);
  const start = f.manager.start(
    { command: node("process.stdout.write('a'.repeat(2000)+'TAIL');process.exitCode=7") },
    f.scope,
    { ...f.config, max_output: 100 },
    "call",
  );
  const done = await f.manager.wait(start.process_id, f.scope, undefined, 2);
  assert.equal(done.status, "failed");
  assert.equal(done.output.length, 100);
  assert.match(done.output, /TAIL$/);
  assert.equal(done.truncated, 1);
  assert.equal(done.exit_code, 7);
  const bad = f.manager.start({ command: "echo x", workdir: "absent" }, f.scope, f.config);
  const failure = await f.manager.wait(bad.process_id, f.scope, undefined, 2);
  assert.equal(failure.status, "failed");
  assert.match(failure.error, /ENOENT/);
});

test("停止与执行器关闭终止整个后台进程组，不留下后续副作用", async (t) => {
  const f = await fixture(t);
  const source =
    "process.stdout.write('ready');setTimeout(()=>require('fs').writeFileSync('escaped','yes'),600)";
  const one = f.manager.start({ command: node(source) }, f.scope, f.config);
  await until(() => f.manager.info(one.process_id, f.scope).output.includes("ready"));
  const stopped = await f.manager.cancel(one.process_id, f.scope);
  assert.equal(stopped.status, "cancelled");
  const two = f.manager.start({ command: node(source) }, f.scope, f.config);
  await until(() => f.manager.info(two.process_id, f.scope).output.includes("ready"));
  await f.manager.close();
  assert.equal(f.manager.info(two.process_id, f.scope).status, "cancelled");
  await delay(700);
  await assert.rejects(fs.access(path.join(f.root, "escaped")));
});

test(
  "主命令退出时清理继承进程组的后台子进程",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t);
    const child = node("setTimeout(()=>require('fs').writeFileSync('orphan','yes'),600)");
    const started = f.manager.start({ command: `${child} &\nprintf done` }, f.scope, f.config);
    const done = await f.manager.wait(started.process_id, f.scope, undefined, 2);
    assert.equal(done.status, "completed");
    await delay(700);
    await assert.rejects(fs.access(path.join(f.root, "orphan")));
  },
);

test("无管理器不能脱管启动，活动上限与 stdio 参数被校验", async (t) => {
  const f = await fixture(t);
  const unavailable = await runTool(shellCall({ background: true, command: "echo no" }), f.config);
  assert.equal(unavailable.failed, true);
  const record = f.manager.start({ command: node("setInterval(()=>{},1000)") }, f.scope, f.config);
  await assert.rejects(
    f.manager.stdio({ process_id: record.process_id, action: "write", input: 2 }, f.scope),
    /input/,
  );
  await assert.rejects(
    f.manager.stdio({ process_id: record.process_id, action: "unknown" }, f.scope),
    /action/,
  );
  for (let i = 1; i < 8; i++) {
    f.manager.start({ command: node("setInterval(()=>{},1000)") }, f.scope, f.config);
  }
  assert.throws(() => f.manager.start({ command: "echo no" }, f.scope, f.config), /8 条/);
});

async function webFixture(t, respond) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-shell-web-"));
  const p = paths({ AGENT_HOME: root });
  const url = await modelServer(t, respond);
  const config = {
    ...configured({ url, key: "test", model: "gpt-6-luna" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "shell-test-access-token" },
  };
  const runtime = createServer({ p, config });
  const origin = await runtime.listen();
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
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, p, config, runtime, origin, request, session };
}
const answer = () => ({
  output: [message("后台命令已启动。", "output_text", "assistant")],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
});

test("Web 回复后后台继续运行，列表详情不跳转，API 管道和删除会话清理记录", async (t) => {
  let count = 0;
  const f = await webFixture(t, () => {
    if (count++ === 0) {
      return {
        output: [
          {
            type: "function_call",
            ...shellCall({
              background: true,
              command: node("process.stdout.write('ready\\n');process.stdin.pipe(process.stdout)"),
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    }
    return answer();
  });
  const reply = await runReply(f.request, `/api/sessions/${f.session.id}/messages`, {
    text: "启动后台",
  });
  assert.equal(reply.at(-1).status, "completed");
  const list = await (await f.request(`/api/processes?session_id=${f.session.id}`)).json();
  assert.equal(list.processes.length, 1);
  const job = list.processes[0];
  assert.equal(job.status, "running");
  assert.equal(job.output, undefined);
  await until(async () =>
    (await (await f.request(`/api/processes/${job.id}`)).json()).output.includes("ready"),
  );
  assert.equal((await fetch(f.origin + `/api/processes/${job.id}`)).status, 401);
  assert.equal(
    (await f.request(`/api/processes/${job.id}/stdio/unknown`, "POST", { action: "cancel" }))
      .status,
    404,
  );
  assert.equal(
    (await f.request(`/api/processes/${job.id}/stdio`, "POST", { action: "write", input: 3 }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request(`/api/processes/${job.id}/stdio`, "POST", {
        action: "write",
        input: "hello\n",
      })
    ).status,
    200,
  );
  await until(async () =>
    (await (await f.request(`/api/processes/${job.id}`)).json()).output.includes("hello"),
  );
  const stop = await (
    await f.request(`/api/processes/${job.id}/stdio`, "POST", { action: "cancel" })
  ).json();
  assert.equal(stop.status, "cancelled");
  const another = f.runtime.db
    .prepare(
      "SELECT COUNT(*) n FROM messages WHERE session_id = ? AND json_extract(item,'$.name') = 'shell'",
    )
    .get(f.session.id).n;
  assert.equal(another, 1);
  await f.request(`/api/sessions/${f.session.id}`, "DELETE");
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM shell_jobs").get().n, 0);
});

test("停止会话清理后台进程，CLI 退出也保留停止记录", async (t) => {
  let count = 0;
  const f = await webFixture(t, () => {
    if (count++ % 2 === 0) {
      return {
        output: [
          {
            type: "function_call",
            ...shellCall({ background: true, command: node("setInterval(()=>{},1000)") }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    }
    return answer();
  });
  await runReply(f.request, `/api/sessions/${f.session.id}/messages`, { text: "后台" });
  await f.request(`/api/sessions/${f.session.id}/cancel`, "POST", {});
  assert.equal(f.runtime.db.prepare("SELECT status FROM shell_jobs").get().status, "cancelled");
  await ask("启动后台", f.config, { locations: f.p, modelId: "main", compactModelId: "compact" });
  const rows = f.runtime.db.prepare("SELECT status FROM shell_jobs").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.status === "cancelled"));
});

test("其他执行器停止命令时等待原执行器完成清理，再删除记录", async (t) => {
  const f = await fixture(t);
  const other = createShellManager(f.db);
  t.after(() => other.close());
  const started = f.manager.start(
    { command: node("process.stdout.write('ready');setInterval(()=>{},1000)") },
    f.scope,
    f.config,
  );
  await until(() => f.manager.info(started.process_id, f.scope).output.includes("ready"));
  const stopped = await other.cancel(started.process_id, f.scope);
  assert.equal(stopped.status, "cancelled");
  f.db.prepare("DELETE FROM shell_jobs WHERE id = ?").run(started.process_id);
});

test("子 Agent 的后台命令归属任务，在该任务结束时清理", async (t) => {
  let count = 0;
  const f = await webFixture(t, () => {
    if (count++ === 0) {
      return {
        output: [
          {
            type: "function_call",
            ...shellCall({ background: true, command: node("setInterval(()=>{},1000)") }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    }
    return answer();
  });
  const started = await (
    await f.request("/api/tasks", "POST", { session_id: f.session.id, task: "后台测试" })
  ).json();
  await until(
    () =>
      f.runtime.db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(started.task_id || started.id)?.status === "completed",
  );
  const record = f.runtime.db.prepare("SELECT * FROM shell_jobs").get();
  assert.equal(record.task_id, started.task_id || started.id);
  assert.equal(record.status, "cancelled");
});
