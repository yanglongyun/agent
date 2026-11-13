import { configured } from "./config-fixture.js";
import { runReply } from "./events.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../index.js";
import { paths } from "../config.js";
import { message } from "../ai/index.js";
import { loadContext } from "../session.js";
import modelServer from "./model.js";

const usage = { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 };
const answer = (text) => ({ output: [message(text, "output_text", "assistant")], usage });
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

async function fixture(t, respond = () => answer("回答")) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-branches-"));
  const p = paths({ AGENT_HOME: root });
  const url = await modelServer(t, respond);
  const config = {
    ...configured({ url, key: "test", model: "gpt-6-luna" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "branch-test-access-token" },
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
  const create = async (title = "") =>
    await (await request("/api/sessions", "POST", { title })).json();
  const send = async (id, text, images = []) => {
    const events = await runReply(request, `/api/sessions/${id}/messages`, { text, images });
    assert.equal(
      events.at(-1).status,
      "completed",
      JSON.stringify(events.filter((e) => e.type === "error")),
    );
  };
  const history = async (id) =>
    (await (await request(`/api/sessions/${id}/messages?limit=500`)).json()).messages;
  const branch = (id, messageId) =>
    request(`/api/sessions/${id}/branches`, "POST", { message_id: messageId });
  return { root, p, runtime, request, create, send, history, branch };
}

test("分支只复制到所选 AI 回答，保留环境与时间，继承历史不计费，继续对话不包含原会话后续内容", async (t) => {
  const inputs = [];
  const f = await fixture(t, (request) => {
    inputs.push(request.input);
    const text = request.input.findLast((i) => i.role === "user").content[0].text;
    return answer(text === "第一问" ? "第一答" : "第二答");
  });
  const source = await f.create("方案讨论");
  await f.send(source.id, "第一问");
  const first = await f.history(source.id);
  await f.send(source.id, "第二问");
  const original = await f.history(source.id);
  const response = await f.branch(source.id, first.at(-1).id);
  assert.equal(response.status, 201);
  const fork = await response.json();
  assert.equal(fork.title, "方案讨论（2）");
  assert.notEqual(fork.id, source.id);
  assert.deepEqual(fork.cost, { amount: 0, currency: "USD", unpriced_requests: 0 });
  assert.equal(fork.request_count, 0);
  const copied = await f.history(fork.id);
  assert.deepEqual(
    copied.map((r) => r.item),
    first.map((r) => r.item),
  );
  assert.deepEqual(
    copied.map((r) => r.created_at),
    first.map((r) => r.created_at),
  );
  assert.deepEqual(copied[0].meta.environment, first[0].meta.environment);
  assert.ok(copied.every((r) => r.meta.inherited && r.usage === null && r.metering === null));
  const context = loadContext(f.runtime.db, { sessionId: fork.id });
  assert.equal(context.usage, null);
  assert.equal(context.lastResponseAt, null);
  await f.send(fork.id, "沿分支继续");
  const input = inputs.at(-1);
  assert.ok(input.some((i) => i.role === "assistant" && i.content[0].text === "第一答"));
  assert.ok(!JSON.stringify(input).includes("第二问"));
  assert.deepEqual(await f.history(source.id), original);
  const updated = await (await f.request(`/api/sessions/${fork.id}`)).json();
  assert.equal(updated.request_count, 1);
  assert.equal(updated.cost.amount, 0.00015);
  assert.equal((await (await f.request(`/api/sessions/${source.id}`)).json()).cost.amount, 0.0003);
});

test("分支并发命名依次编号，未命名对话使用当前预览，长标题按字符保留完整后缀", async (t) => {
  const f = await fixture(t);
  const source = await f.create();
  await f.send(source.id, "第一条问题");
  const target = (await f.history(source.id)).at(-1).id;
  const responses = await Promise.all([f.branch(source.id, target), f.branch(source.id, target)]);
  assert.ok(responses.every((r) => r.status === 201));
  const copies = await Promise.all(responses.map((r) => r.json()));
  assert.deepEqual(copies.map((r) => r.title).sort(), ["第一条问题（2）", "第一条问题（3）"]);
  await f.request(`/api/sessions/${source.id}`, "PATCH", { title: "🌳".repeat(120) });
  const long = await (await f.branch(source.id, target)).json();
  assert.equal([...long.title].length, 120);
  assert.equal(long.title, "🌳".repeat(117) + "（2）");
});

test("分支保留工具链、用户图片和工具图片；删除原对话不影响分支图片和后续模型输入", async (t) => {
  const f = await fixture(t, (request) => {
    const last = request.input.at(-1);
    if (last.type === "function_call_output") {
      return answer("看到了图片");
    }
    if (last.content[0].text === "看图") {
      return {
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "读取图片" }] },
          {
            type: "function_call",
            name: "read",
            call_id: "picture-call",
            arguments: '{"path":"sample.png"}',
          },
        ],
        usage,
      };
    }
    const pictures = request.input
      .flatMap((i) => (Array.isArray(i.output) ? i.output : i.content || []))
      .filter((p) => p.type === "input_image");
    assert.equal(pictures.length, 2);
    assert.ok(pictures.every((p) => p.image_url === png));
    return answer("可以继续看图");
  });
  await fs.writeFile(path.join(f.root, "sample.png"), Buffer.from(png.split(",")[1], "base64"));
  const source = await f.create("图片讨论");
  await f.send(source.id, "看图", [png]);
  const original = await f.history(source.id);
  const fork = await (await f.branch(source.id, original.at(-1).id)).json();
  const copied = await f.history(fork.id);
  assert.deepEqual(
    copied.map((r) => r.item.type),
    original.map((r) => r.item.type),
  );
  assert.equal(copied.find((r) => r.item.type === "function_call").item.call_id, "picture-call");
  const pictures = copied
    .flatMap((r) => (Array.isArray(r.item.output) ? r.item.output : r.item.content || []))
    .filter((p) => p.type === "input_image");
  assert.equal((await fs.readdir(f.p.images)).length, 4);
  assert.equal(pictures.length, 2);
  assert.equal((await f.request(`/api/sessions/${source.id}`, "DELETE")).status, 200);
  assert.equal((await fs.readdir(f.p.images)).length, 2);
  for (const picture of pictures) {
    const image = await f.request(picture.image_url);
    assert.equal(image.status, 200);
    assert.deepEqual(
      Buffer.from(await image.arrayBuffer()),
      Buffer.from(png.split(",")[1], "base64"),
    );
  }
  await f.send(fork.id, "继续");
  assert.equal((await f.request(`/api/sessions/${fork.id}`, "DELETE")).status, 200);
  assert.deepEqual(await fs.readdir(f.p.images), []);
});

test("压缩摘要只复制回答当时已有的记录，重映射消息边界且不复制计费", async (t) => {
  const f = await fixture(t);
  const source = await f.create("压缩讨论");
  const insert = f.runtime.db.prepare(
    "INSERT INTO messages (session_id,item,created_at) VALUES (?,?,?)",
  );
  const ids = [];
  for (const [text, role, time] of [
    ["早期问题", "user", 10],
    ["早期回答", "assistant", 20],
    ["当前问题", "user", 30],
    ["分支回答", "assistant", 40],
    ["之后的问题", "user", 50],
  ]) {
    ids.push(
      Number(
        insert.run(
          source.id,
          JSON.stringify(message(text, role === "user" ? "input_text" : "output_text", role)),
          time,
        ).lastInsertRowid,
      ),
    );
  }
  f.runtime.db
    .prepare("INSERT INTO compactions (session_id,through_id,summary,created_at) VALUES (?,?,?,?)")
    .run(source.id, ids[1], "早期摘要", 25);
  f.runtime.db
    .prepare("INSERT INTO compactions (session_id,through_id,summary,created_at) VALUES (?,?,?,?)")
    .run(source.id, ids[3], "后来生成的摘要", 55);
  const fork = await (await f.branch(source.id, ids[3])).json();
  const copied = await f.history(fork.id);
  const summaries = (await (await f.request(`/api/sessions/${fork.id}/compactions`)).json())
    .compactions;
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].summary, "早期摘要");
  assert.equal(summaries[0].through_id, copied[1].id);
  assert.equal(summaries[0].usage, null);
  const context = loadContext(f.runtime.db, { sessionId: fork.id });
  assert.deepEqual(
    context.messages.map((i) => i.content[0].text),
    ["早期摘要", "当前问题", "分支回答"],
  );
  assert.equal(
    f.runtime.db.prepare("SELECT COUNT(*) n FROM metering WHERE session_id = ?").get(fork.id).n,
    0,
  );
});

test("拒绝其他会话、用户消息和未完成工具边界；失败不残留新会话或已复制图片", async (t) => {
  const f = await fixture(t);
  const source = await f.create();
  const other = await f.create();
  await f.send(source.id, "有图片", [png]);
  await f.send(other.id, "其他对话");
  const history = await f.history(source.id);
  const target = history.at(-1).id;
  assert.equal((await f.branch(source.id, 0)).status, 400);
  assert.equal((await f.branch(source.id, (await f.history(other.id)).at(-1).id)).status, 404);
  assert.equal((await f.branch(source.id, history[0].id)).status, 400);
  f.runtime.db.exec(
    "CREATE TRIGGER reject_branch BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'branch failed'); END",
  );
  assert.equal((await f.branch(source.id, target)).status, 500);
  f.runtime.db.exec("DROP TRIGGER reject_branch");
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 2);
  assert.equal((await fs.readdir(f.p.images)).length, 1);
  const insert = f.runtime.db.prepare(
    "INSERT INTO messages (session_id,item,created_at) VALUES (?,?,?)",
  );
  insert.run(
    source.id,
    JSON.stringify({ type: "function_call", call_id: "unfinished", name: "read", arguments: "{}" }),
    Date.now(),
  );
  const unfinished = insert.run(
    source.id,
    JSON.stringify(message("还在执行", "output_text", "assistant")),
    Date.now(),
  );
  assert.equal((await f.branch(source.id, Number(unfinished.lastInsertRowid))).status, 409);
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 2);
  assert.equal((await f.request(`/api/sessions/${source.id}/branches`, "GET")).status, 405);
});
