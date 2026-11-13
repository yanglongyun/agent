import { configured, selectedInput } from "./config-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "../index.js";
import { paths } from "../config.js";
import { loadContext, forkContext } from "../session.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";
import { runReply, startReply } from "./events.js";

const upload = (name, text, type = "text/plain") => ({
  name,
  data: `data:${type};base64,${Buffer.from(text).toString("base64")}`,
});
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const answer = (text) => ({
  output: [message(text, "output_text", "assistant")],
  usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
});

async function fixture(t, respond = () => answer("已收到")) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-attachments-"));
  const p = paths({ AGENT_HOME: root });
  const url = await modelServer(t, respond);
  const config = {
    ...configured({ url, key: "test", model: "gpt-6-luna" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "test-attachment-token" },
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
  const create = async () => (await (await request("/api/sessions", "POST", {})).json()).id;
  const history = async (id) => await (await request(`/api/sessions/${id}/messages`)).json();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { p, root, origin, runtime, request, create, history };
}

test("纯附件消息保存元数据，Agent 可通过 read 读真实文件，下载鉴权且正文不含路径或 Base64", async (t) => {
  let calls = 0;
  const inputs = [];
  const f = await fixture(t, (request) => {
    inputs.push(structuredClone(request.input));
    calls++;
    if (calls === 1) {
      const part = request.input[0].content.find((part) =>
        part.text?.startsWith("\n\n用户上传的附件"),
      );
      const files = JSON.parse(part.text.slice(part.text.indexOf("[")));
      assert.equal(files[0].name, "预算 说明.txt");
      return {
        output: [
          {
            type: "function_call",
            call_id: "read-upload",
            name: "read",
            arguments: JSON.stringify({ path: files[0].path }),
          },
        ],
        usage: { total_tokens: 10 },
      };
    }
    const result = request.input.find((item) => item.type === "function_call_output");
    assert.match(JSON.parse(result.output).text, /预算为 42 元/);
    return answer("预算为 42 元");
  });
  const id = await f.create();
  const run = await startReply(f.request, `/api/sessions/${id}/messages`, {
    text: "",
    attachments: [upload("预算 说明.txt", "预算为 42 元")],
  });
  const list = await run.events;
  assert.equal(list.at(-1).status, "completed");
  const file = run.accepted.message.meta.attachments[0];
  assert.equal(file.size, Buffer.byteLength("预算为 42 元"));
  assert.match(file.path, /预算 说明\.txt$/);
  assert.equal(file.url.startsWith("/api/attachments/"), true);
  assert.deepEqual(run.accepted.message.item.content, []);
  assert.equal(list[0].meta.attachments.length, 1);
  assert.deepEqual(list[0].saved[0].meta.attachments, [file]);
  assert.equal(JSON.stringify(list).includes("base64"), false);
  const stored = await f.history(id);
  assert.deepEqual(stored.messages[0].meta.attachments, [file]);
  assert.deepEqual(stored.messages[0].item.content, []);
  assert.equal(stored.session.preview, file.name);
  const sessions = await (await f.request("/api/sessions")).json();
  assert.equal(sessions.sessions[0].preview, file.name);
  assert.equal((await fetch(f.origin + file.url)).status, 401);
  const download = await f.request(file.url);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.match(download.headers.get("content-disposition"), /attachment; filename\*=UTF-8''/);
  assert.equal(await download.text(), "预算为 42 元");
  assert.equal(
    (await f.request(file.url, "HEAD")).headers.get("content-length"),
    String(file.size),
  );
  assert.equal((await f.request(file.url, "POST", {})).status, 405);
  assert.equal((await f.request("/api/attachments/%2e%2e")).status, 404);
  assert.equal((await f.request(file.url + "/extra")).status, 404);
  const context = loadContext(f.runtime.db, { sessionId: id });
  assert.deepEqual(context.messages[0], inputs[0][0]);
});

test("图片和普通文件混合保留各自表示，二进制文件原样保存，子 Agent 分叉能读取附件", async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  const binary = Buffer.from([0x50, 0x4b, 0, 0xff, 0x12]);
  const list = await runReply(f.request, `/api/sessions/${id}/messages`, {
    text: "处理这些文件",
    images: [png],
    attachments: [upload("资料.zip", binary, "application/zip")],
  });
  assert.equal(list.at(-1).status, "completed");
  const page = await f.history(id);
  assert.equal(page.messages[0].item.content[1].type, "input_image");
  const file = page.messages[0].meta.attachments[0];
  assert.deepEqual(await fs.readFile(file.path), binary);
  assert.deepEqual(Buffer.from(await (await f.request(file.url)).arrayBuffer()), binary);
  f.runtime.db
    .prepare("INSERT INTO tasks (id, session_id, status) VALUES (?, ?, 'completed')")
    .run("file-child", id);
  forkContext(f.runtime.db, { sessionId: id }, { taskId: "file-child" });
  const child = loadContext(f.runtime.db, { taskId: "file-child" });
  assert.match(JSON.stringify(child.messages), /资料.zip/);
  assert.match(JSON.stringify(child.messages), new RegExp(path.basename(path.dirname(file.path))));
  await f.request(`/api/sessions/${id}`, "DELETE");
  assert.equal((await f.request(file.url)).status, 404);
  assert.deepEqual(await fs.readdir(f.p.attachments), []);
});

test("分支复制独立附件与路径，原会话删除后仍可继续；失败分支清理新副本", async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await runReply(f.request, `/api/sessions/${id}/messages`, {
    text: "",
    attachments: [upload("报告.md", "# 原始报告")],
  });
  const original = await f.history(id);
  const source = original.messages[0].meta.attachments[0];
  const last = original.messages.at(-1).id;
  f.runtime.db.exec(
    "CREATE TRIGGER reject_fork BEFORE INSERT ON messages WHEN NEW.session_id != '" +
      id +
      "' BEGIN SELECT RAISE(ABORT, 'fork failed'); END",
  );
  assert.equal(
    (await f.request(`/api/sessions/${id}/branches`, "POST", { message_id: last })).status,
    500,
  );
  assert.equal((await fs.readdir(f.p.attachments)).length, 1);
  f.runtime.db.exec("DROP TRIGGER reject_fork");
  const fork = await (
    await f.request(`/api/sessions/${id}/branches`, "POST", { message_id: last })
  ).json();
  assert.equal(fork.title, "报告.md（2）");
  const copied = (await f.history(fork.id)).messages[0].meta.attachments[0];
  assert.notEqual(copied.url, source.url);
  assert.notEqual(copied.path, source.path);
  await f.request(`/api/sessions/${id}`, "DELETE");
  assert.equal((await f.request(source.url)).status, 404);
  assert.equal(await (await f.request(copied.url)).text(), "# 原始报告");
  assert.match(
    JSON.stringify(loadContext(f.runtime.db, { sessionId: fork.id }).messages),
    new RegExp(path.basename(path.dirname(copied.path))),
  );
  assert.equal(
    (await runReply(f.request, `/api/sessions/${fork.id}/messages`, { text: "继续" })).at(-1)
      .status,
    "completed",
  );
  await f.request(`/api/sessions/${fork.id}`, "DELETE");
  assert.deepEqual(await fs.readdir(f.p.attachments), []);
});

test("无效附件批次、数量和大小在写入前拒绝；用户消息回滚清理文件，模型失败保留已提交文件", async (t) => {
  const f = await fixture(t, () => {
    throw new Error("上游失败");
  });
  const id = await f.create();
  const invalid = [
    { attachments: [upload("../bad.txt", "x")] },
    { attachments: [upload("a/b.txt", "x")] },
    { attachments: [upload("\u0000.txt", "x")] },
    { attachments: [{ name: "a.txt", data: "data:text/plain;base64,====" }] },
    { attachments: [{ ...upload("a.txt", "x"), path: "/private/file" }] },
    { attachments: "invalid" },
    { attachments: Array(6).fill(upload("a.txt", "x")) },
    { images: Array(5).fill(png), attachments: [upload("a.txt", "x")] },
  ];
  for (const data of invalid) {
    assert.equal(
      (await f.request(`/api/sessions/${id}/messages`, "POST", { text: "文件", ...data })).status,
      400,
    );
  }
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
  assert.deepEqual(await fs.readdir(f.p.attachments).catch(() => []), []);
  const large = upload("large.bin", Buffer.alloc(25 * 1024 * 1024 + 1), "application/octet-stream");
  assert.equal(
    (await f.request(`/api/sessions/${id}/messages`, "POST", { text: "", attachments: [large] }))
      .status,
    413,
  );
  f.runtime.db.exec(
    "CREATE TRIGGER reject_input BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'input failed'); END",
  );
  assert.equal(
    (
      await f.request(`/api/sessions/${id}/messages`, "POST", {
        text: "",
        attachments: [upload("失败.txt", "data")],
      })
    ).status,
    500,
  );
  assert.deepEqual(await fs.readdir(f.p.attachments), []);
  f.runtime.db.exec("DROP TRIGGER reject_input");
  const result = await runReply(f.request, `/api/sessions/${id}/messages`, {
    text: "",
    attachments: [upload("保留.txt", "data")],
  });
  assert.equal(result.at(-1).status, "incomplete");
  assert.equal((await fs.readdir(f.p.attachments)).length, 1);
  assert.equal((await f.history(id)).messages[0].meta.attachments.length, 1);
});
