import { configured } from "./config-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../index.js";
import { paths } from "../config.js";
import { summarizeUsage } from "../metering/index.js";

const CLAUDE_USAGE = {
  input_tokens: 10,
  output_tokens: 20,
  cache_read_input_tokens: 5,
  cache_creation_input_tokens: 7,
};
const OPENAI_USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  total_tokens: 150,
  input_tokens_details: { cached_tokens: 40 },
};

const priced = (model, amount) => ({
  protocol: "anthropic-messages",
  model,
  endpoint: "https://example.test",
  context_tokens: 1000,
  cost: { amount, currency: "USD", basis: "list_price_estimate", units: [] },
  status: "priced",
});
const unpriced = (model) => ({
  protocol: "responses",
  model,
  endpoint: "https://example.test",
  context_tokens: null,
  cost: null,
  status: "unpriced",
});

const text = (value, type = "input_text") => ({ type, text: value });
const userItem = (value) => ({ type: "message", role: "user", content: [text(value)] });
const assistantItem = (value) => ({
  type: "message",
  role: "assistant",
  content: [text(value, "output_text")],
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-logs-"));
  const p = paths({ AGENT_HOME: root });
  const config = {
    ...configured({ url: "http://127.0.0.1:1/v1", key: "test", model: "gpt-6-luna" }),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "logs-test-access-token" },
  };
  const runtime = createServer({ p, config });
  const origin = await runtime.listen();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const db = runtime.db;
  const request = (url, method = "GET") =>
    fetch(origin + url, { method, headers: { authorization: "Bearer " + config.api.token } });
  const get = async (url) => {
    const response = await request(url);
    return { status: response.status, body: await response.json() };
  };

  const addSession = (id, title, updated, nanos = 0, unpricedCount = 0, requests = 0) =>
    db
      .prepare(
        `INSERT INTO sessions (id, title, total_cost_nanos, unpriced_requests, request_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, title, nanos, unpricedCount, requests, 1000, updated);
  const addTask = (id, sessionId, task, model, status, updated, nanos = 0, requests = 0) =>
    db
      .prepare(
        `INSERT INTO tasks (id, session_id, task, model, status, total_cost_nanos, unpriced_requests, request_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, sessionId, task, model, status, nanos, requests, 1500, updated);
  // owner 是 { sessionId } 或 { taskId }；返回新消息的 id。
  const addMessage = (owner, item, { meta = null, usage = null, at = 1000 } = {}) =>
    Number(
      db
        .prepare(
          "INSERT INTO messages (session_id, task_id, item, meta, usage, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          owner.sessionId ?? null,
          owner.taskId ?? null,
          JSON.stringify(item),
          meta ? JSON.stringify(meta) : null,
          usage ? JSON.stringify(usage) : null,
          at,
        ).lastInsertRowid,
    );
  const addCompaction = (owner, throughId, summary, usage, at) =>
    Number(
      db
        .prepare(
          "INSERT INTO compactions (session_id, task_id, through_id, summary, usage, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          owner.sessionId ?? null,
          owner.taskId ?? null,
          throughId,
          summary,
          JSON.stringify(usage),
          at,
        ).lastInsertRowid,
    );
  const addMetering = (owner, measurement, at, { messageId = null, compactionId = null } = {}) =>
    db
      .prepare(
        "INSERT INTO metering (session_id, task_id, message_id, compaction_id, measurement, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        owner.sessionId ?? null,
        owner.taskId ?? null,
        messageId,
        compactionId,
        JSON.stringify(measurement),
        at,
      );
  return {
    origin,
    config,
    request,
    get,
    addSession,
    addTask,
    addMessage,
    addCompaction,
    addMetering,
  };
}

// 一份覆盖各种形态的数据：对话 s1（含子任务 t1 和一次压缩）、含特殊字符的 s2、
// 只有小写文字的 s3、没有消息的 s4，以及没有消息的子任务 t2。
async function seeded(t) {
  const f = await fixture(t);
  // s1 的累计包含子任务 t1：0.5 + 0.25 + 0.125 + 0.0625 = 0.9375，一次请求未计费，共 5 次请求。
  f.addSession("s1-aaaa", "对话一", 5000, 937500000, 1, 5);
  f.addSession("s2-bbbb", "100%_折扣", 4000);
  f.addSession("s3-cccc", "", 4000);
  f.addSession("s4-dddd", "无消息", 1000);
  f.addTask("t1-xxxx", "s1-aaaa", "统计文件", "claude-haiku-5-5", "completed", 4500, 187500000, 2);
  f.addTask("t2-yyyy", "s2-bbbb", "任务 B", "gpt-5", "running", 3000);

  const s1 = { sessionId: "s1-aaaa" };
  const ids = {};
  ids.user1 = f.addMessage(s1, userItem("你好 hello World"), { meta: { model_id: "x" }, at: 1100 });
  ids.reasoning = f.addMessage(
    s1,
    { type: "reasoning", summary: [text("先想一想", "summary_text")] },
    { at: 1200 },
  );
  ids.call = f.addMessage(
    s1,
    { type: "function_call", call_id: "c1", name: "shell", arguments: '{"command":"ls -la"}' },
    { at: 1300 },
  );
  ids.output = f.addMessage(
    s1,
    {
      type: "function_call_output",
      call_id: "c1",
      output: JSON.stringify({ success: true, text: "file_a.txt" }),
    },
    { at: 1400 },
  );
  ids.answer1 = f.addMessage(s1, assistantItem("完成了 100% 的工作"), {
    usage: CLAUDE_USAGE,
    at: 2000,
  });
  ids.user2 = f.addMessage(s1, userItem("第二问"), { at: 2800 });
  ids.answer2 = f.addMessage(s1, assistantItem("第二答"), { usage: OPENAI_USAGE, at: 3000 });
  f.addMetering(s1, priced("claude-sonnet-5-5", 0.5), 2000, { messageId: ids.answer1 });
  f.addMetering(s1, unpriced("gpt-5"), 3000, { messageId: ids.answer2 });
  ids.compaction = f.addCompaction(
    s1,
    ids.output,
    "早期摘要：讨论了 ls 命令",
    { input_tokens: 3, output_tokens: 4 },
    2500,
  );
  f.addMetering(s1, priced("claude-sonnet-5-5", 0.25), 2500, { compactionId: ids.compaction });

  const t1 = { taskId: "t1-xxxx" };
  ids.taskUser = f.addMessage(t1, userItem("统计文件 TaskInput"), { at: 4300 });
  ids.taskAnswer = f.addMessage(t1, assistantItem("共 3 个"), {
    usage: { input_tokens: 1, output_tokens: 2 },
    at: 4400,
  });
  ids.taskImage = f.addMessage(
    t1,
    {
      type: "function_call_output",
      call_id: "c9",
      output: [text("图片说明"), { type: "input_image", image_url: "/api/images/x.png" }],
    },
    { at: 4450 },
  );
  f.addMetering(t1, priced("claude-haiku-5-5", 0.125), 4400, { messageId: ids.taskAnswer });
  // 子任务自己的压缩：计量行同时有 task_id 和 compaction_id，来源应归为压缩。
  ids.taskCompaction = f.addCompaction(
    t1,
    ids.taskUser,
    "任务摘要",
    { input_tokens: 2, output_tokens: 1 },
    4420,
  );
  f.addMetering(t1, priced("claude-haiku-5-5", 0.0625), 4420, {
    compactionId: ids.taskCompaction,
  });

  const s2 = { sessionId: "s2-bbbb" };
  ids.special = f.addMessage(s2, userItem("100%_折扣 路径 C:\\temp"), { at: 3500 });
  // 形态各异的记录：正文是纯字符串、数组里夹杂非对象、完全没有正文字段。
  ids.stringContent = f.addMessage(
    s2,
    { type: "message", role: "user", content: "纯字符串内容 STR" },
    { at: 3600 },
  );
  ids.mixedContent = f.addMessage(
    s2,
    {
      type: "message",
      role: "user",
      content: ["abc", 5, null, { type: "input_text", text: "mixed" }],
    },
    { at: 3700 },
  );
  ids.unknown = f.addMessage(s2, { type: "unknown" }, { at: 3800 });
  f.addMessage({ sessionId: "s3-cccc" }, userItem("100x折扣 world"), { at: 3900 });
  return { f, ids };
}

const idsOf = (list) => list.map((item) => item.id);

test("summarizeUsage：金额按 nanos 精确累加，token 只汇总顶层 _tokens 非负整数，缺失计量计入未计费", () => {
  assert.deepEqual(summarizeUsage([]), {
    requests: 0,
    cost: { amount: 0, currency: "USD", unpriced_requests: 0 },
    tokens: {},
    models: [],
  });
  const summary = summarizeUsage([
    { usage: { input_tokens: 1, output_tokens: 2 }, measurement: priced("b", 0.1) },
    { usage: { input_tokens: 4, total_tokens: 9 }, measurement: priced("b", 0.2) },
    {
      usage: {
        input_tokens: -1,
        output_tokens: 1.5,
        cache_read_input_tokens: "7",
        reasoning_tokens: 3,
        cached: 99,
        input_tokens_details: { cached_tokens: 40 },
      },
      measurement: unpriced("a"),
    },
    { usage: null, measurement: null },
    { usage: { input_tokens: 5 }, measurement: { model: "b", cost: {} } },
  ]);
  assert.equal(summary.requests, 5);
  // 0.1 + 0.2 在浮点里是 0.30000000000000004，按 nanos 累加必须得到 0.3。
  assert.equal(summary.cost.amount, 0.3);
  assert.equal(summary.cost.currency, "USD");
  assert.equal(summary.cost.unpriced_requests, 3);
  assert.deepEqual(summary.tokens, {
    input_tokens: 10,
    output_tokens: 2,
    total_tokens: 9,
    reasoning_tokens: 3,
  });
  // b 有 3 次请求；未知（缺失计量）和 a 各 1 次，同数时按模型名升序：a 在“未知”之前。
  assert.deepEqual(
    summary.models.map((model) => [model.model, model.requests, model.cost.unpriced_requests]),
    [
      ["b", 3, 1],
      ["a", 1, 1],
      ["未知", 1, 1],
    ],
  );
  const b = summary.models[0];
  assert.equal(b.cost.amount, 0.3);
  assert.deepEqual(b.tokens, { input_tokens: 10, output_tokens: 2, total_tokens: 9 });
});

test("summarizeUsage：每条请求先四舍五入到 nanos 再累加，十次 0.1 恰好是 1", () => {
  const rows = (amounts) =>
    amounts.map((amount) => ({ usage: null, measurement: priced("m", amount) }));
  // 1.4 纳美元每条舍入为 1，两条共 2 纳美元；浮点直接相加会是 2.8 纳美元。
  assert.equal(summarizeUsage(rows([1.4e-9, 1.4e-9])).cost.amount, 2e-9);
  assert.equal(summarizeUsage(rows([1.6e-9])).cost.amount, 2e-9);
  assert.equal(summarizeUsage(rows(Array(10).fill(0.1))).cost.amount, 1);
});

test("summary：总计、按模型、按来源分类，since 只统计此后的请求", async (t) => {
  const { f } = await seeded(t);
  const all = await f.get("/api/logs/summary");
  assert.equal(all.status, 200);
  assert.equal(all.body.since, 0);
  assert.equal(all.body.requests, 5);
  assert.deepEqual(all.body.cost, { amount: 0.9375, currency: "USD", unpriced_requests: 1 });
  assert.deepEqual(all.body.tokens, {
    input_tokens: 116,
    output_tokens: 77,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 7,
    total_tokens: 150,
  });
  assert.deepEqual(
    all.body.models.map((model) => [model.model, model.requests, model.cost.amount]),
    [
      ["claude-haiku-5-5", 2, 0.1875],
      ["claude-sonnet-5-5", 2, 0.75],
      ["gpt-5", 1, 0],
    ],
  );
  // 压缩优先于子任务：子任务自己的压缩也算压缩，其余是对话自己的请求。
  const { session, task, compaction } = all.body.sources;
  assert.equal(session.requests, 2);
  assert.deepEqual(session.cost, { amount: 0.5, currency: "USD", unpriced_requests: 1 });
  assert.equal(task.requests, 1);
  assert.equal(task.cost.amount, 0.125);
  assert.equal(compaction.requests, 2);
  assert.equal(compaction.cost.amount, 0.3125);
  assert.deepEqual(compaction.tokens, { input_tokens: 5, output_tokens: 5 });

  // since 包含边界：2500 时压缩（2500）及之后的 4 次请求都在，2000 的那次不在。
  const later = await f.get("/api/logs/summary?since=2500");
  assert.equal(later.body.since, 2500);
  assert.equal(later.body.requests, 4);
  assert.equal(later.body.sources.compaction.requests, 2);
  assert.equal(later.body.sources.session.requests, 1);
  assert.equal((await f.get("/api/logs/summary?since=4420")).body.requests, 1);
  assert.equal((await f.get("/api/logs/summary?since=4421")).body.requests, 0);
  assert.deepEqual((await f.get("/api/logs/summary?since=9999")).body.models, []);

  for (const bad of ["-1", "abc", "1.5", "", "9007199254740993"]) {
    assert.equal((await f.get(`/api/logs/summary?since=${bad}`)).status, 400, bad);
  }
});

test("owners：对话与子任务合并排序，字段口径正确，kind 与 parent 过滤", async (t) => {
  const { f } = await seeded(t);
  const all = await f.get("/api/logs/owners");
  assert.equal(all.status, 200);
  assert.equal(all.body.has_more, false);
  // updated_at 降序，同时间按 id 降序（s3 在 s2 之前）。
  assert.deepEqual(idsOf(all.body.owners), [
    "s1-aaaa",
    "t1-xxxx",
    "s3-cccc",
    "s2-bbbb",
    "t2-yyyy",
    "s4-dddd",
  ]);
  const byId = Object.fromEntries(all.body.owners.map((owner) => [owner.id, owner]));
  assert.deepEqual(byId["s1-aaaa"], {
    kind: "session",
    id: "s1-aaaa",
    title: "对话一",
    preview: "你好 hello World",
    session_id: null,
    session_title: null,
    model: null,
    status: null,
    cost: { amount: 0.9375, currency: "USD", unpriced_requests: 1 },
    request_count: 5,
    message_count: 7,
    created_at: 1000,
    updated_at: 5000,
  });
  assert.deepEqual(byId["t1-xxxx"], {
    kind: "task",
    id: "t1-xxxx",
    title: "统计文件",
    preview: "",
    session_id: "s1-aaaa",
    session_title: "对话一",
    model: "claude-haiku-5-5",
    status: "completed",
    cost: { amount: 0.1875, currency: "USD", unpriced_requests: 0 },
    request_count: 2,
    message_count: 3,
    created_at: 1500,
    updated_at: 4500,
  });
  assert.equal(byId["s3-cccc"].title, "");
  assert.equal(byId["s3-cccc"].preview, "100x折扣 world");
  assert.equal(byId["s4-dddd"].preview, "");
  assert.equal(byId["s4-dddd"].message_count, 0);
  assert.equal(byId["t2-yyyy"].session_title, "100%_折扣");
  assert.equal(byId["t2-yyyy"].message_count, 0);

  assert.deepEqual(idsOf((await f.get("/api/logs/owners?kind=task")).body.owners), [
    "t1-xxxx",
    "t2-yyyy",
  ]);
  assert.deepEqual(idsOf((await f.get("/api/logs/owners?kind=session")).body.owners), [
    "s1-aaaa",
    "s3-cccc",
    "s2-bbbb",
    "s4-dddd",
  ]);
  assert.deepEqual(idsOf((await f.get("/api/logs/owners?parent=s1-aaaa")).body.owners), [
    "t1-xxxx",
  ]);
  assert.deepEqual(idsOf((await f.get("/api/logs/owners?parent=s4-dddd")).body.owners), []);
});

test("owners：关键字不区分大小写，命中标题、ID 或记录正文，% _ \\ 按字面量匹配", async (t) => {
  const { f } = await seeded(t);
  const search = async (q) =>
    idsOf((await f.get(`/api/logs/owners?q=${encodeURIComponent(q)}`)).body.owners);
  assert.deepEqual(await search("统计"), ["t1-xxxx"]); // 子任务标题；子任务自己的消息也含有
  assert.deepEqual(await search("S2-BBBB"), ["s2-bbbb"]); // ID 不区分大小写
  assert.deepEqual(await search("先想"), ["s1-aaaa"]); // 思考摘要
  assert.deepEqual(await search("ls -la"), ["s1-aaaa"]); // 工具调用参数
  assert.deepEqual(await search("file_a"), ["s1-aaaa"]); // 工具返回文本
  assert.deepEqual(await search("图片说明"), ["t1-xxxx"]); // 工具返回是数组时按其 JSON 文本匹配
  assert.deepEqual(await search("WORLD"), ["s1-aaaa", "s3-cccc"]); // 大小写不敏感
  assert.deepEqual(await search("纯字符串内容"), ["s2-bbbb"]); // 正文是纯字符串
  assert.deepEqual(await search("MIXED"), ["s2-bbbb"]); // 数组里夹杂非对象
  assert.deepEqual(await search("不存在的词"), []);

  // 通配符必须按字面量：% 只命中真正含 % 的，_ 同理，100%_折扣 不会命中 100x折扣。
  assert.deepEqual(await search("%"), ["s1-aaaa", "s2-bbbb"]);
  // t1 的工具返回是数组，按其 JSON 文本匹配，键 image_url 里的下划线是真实命中。
  assert.deepEqual(await search("_"), ["s1-aaaa", "t1-xxxx", "s2-bbbb"]);
  assert.deepEqual(await search("_折"), ["s2-bbbb"]);
  assert.deepEqual(await search("\\"), ["s2-bbbb"]);
  assert.deepEqual(await search("100%_折扣"), ["s2-bbbb"]);
  assert.deepEqual(await search("100x折扣"), ["s3-cccc"]);
  // 首尾空白被忽略；空白关键字等于不过滤。
  assert.deepEqual(await search("  统计  "), ["t1-xxxx"]);
  assert.equal((await search("   ")).length, 6);
});

test("owners：limit 与 before 分页，has_more 准确，非法参数返回 400", async (t) => {
  const { f } = await seeded(t);
  const first = await f.get("/api/logs/owners?limit=2");
  assert.deepEqual(idsOf(first.body.owners), ["s1-aaaa", "t1-xxxx"]);
  assert.equal(first.body.has_more, true);
  // before 是 updated_at 游标：取更早的（严格小于）。
  const second = await f.get("/api/logs/owners?limit=2&before=4500");
  assert.deepEqual(idsOf(second.body.owners), ["s3-cccc", "s2-bbbb"]);
  assert.equal(second.body.has_more, true);
  const third = await f.get("/api/logs/owners?limit=2&before=4000");
  assert.deepEqual(idsOf(third.body.owners), ["t2-yyyy", "s4-dddd"]);
  assert.equal(third.body.has_more, false);
  assert.equal((await f.get("/api/logs/owners?limit=6")).body.has_more, false);
  assert.equal((await f.get("/api/logs/owners?limit=5")).body.has_more, true);
  assert.equal((await f.get("/api/logs/owners?limit=200")).status, 200);

  for (const bad of [
    "kind=other",
    "limit=0",
    "limit=201",
    "limit=abc",
    "limit=",
    "limit=1.5",
    "before=abc",
    "before=-1",
    `q=${"x".repeat(201)}`,
  ]) {
    assert.equal((await f.get(`/api/logs/owners?${bad}`)).status, 400, bad);
  }
  assert.equal((await f.get(`/api/logs/owners?q=${"字".repeat(200)}`)).status, 200);
});

test("records：type 过滤、消息字段、计量关联，summary 类型只返回压缩", async (t) => {
  const { f, ids } = await seeded(t);
  const read = (query) => f.get(`/api/logs/records?kind=session&id=s1-aaaa&${query}`);
  const all = await read("type=all");
  assert.equal(all.status, 200);
  assert.deepEqual(idsOf(all.body.records), [
    ids.user1,
    ids.reasoning,
    ids.call,
    ids.output,
    ids.answer1,
    ids.user2,
    ids.answer2,
  ]);
  assert.equal(all.body.has_more, false);
  assert.deepEqual(idsOf((await read("type=message")).body.records), [
    ids.user1,
    ids.answer1,
    ids.user2,
    ids.answer2,
  ]);
  assert.deepEqual(idsOf((await read("type=tool")).body.records), [ids.call, ids.output]);
  assert.deepEqual(idsOf((await read("type=reasoning")).body.records), [ids.reasoning]);
  assert.deepEqual(idsOf((await read("type=usage")).body.records), [ids.answer1, ids.answer2]);
  const summaryOnly = await read("type=summary");
  assert.deepEqual(summaryOnly.body.records, []);
  assert.equal(summaryOnly.body.has_more, false);
  assert.deepEqual(idsOf(summaryOnly.body.compactions), [ids.compaction]);
  // 缺省 type 等于 all。
  assert.equal((await read("")).body.records.length, 7);

  // 字段与现有 readMessages 一致，item/meta/usage/metering 都是解析后的对象。
  const [user1, , call, , answer1, , answer2] = all.body.records;
  assert.deepEqual(user1, {
    id: ids.user1,
    session_id: "s1-aaaa",
    task_id: null,
    item: userItem("你好 hello World"),
    meta: { model_id: "x" },
    usage: null,
    metering: null,
    created_at: 1100,
  });
  assert.equal(call.item.arguments, '{"command":"ls -la"}');
  assert.equal(call.meta, null);
  assert.deepEqual(answer1.usage, CLAUDE_USAGE);
  assert.equal(answer1.metering.cost.amount, 0.5);
  assert.equal(answer1.metering.model, "claude-sonnet-5-5");
  assert.deepEqual(answer2.usage, OPENAI_USAGE);
  assert.equal(answer2.metering.cost, null);
  assert.equal(answer2.metering.status, "unpriced");

  // owner 与 owners 列表口径一致。
  assert.equal(all.body.owner.id, "s1-aaaa");
  assert.equal(all.body.owner.kind, "session");
  assert.equal(all.body.owner.message_count, 7);
  assert.equal(all.body.owner.preview, "你好 hello World");
});

test("records：关键字过滤消息和压缩，分页用 before 与 has_more，压缩不参与分页", async (t) => {
  const { f, ids } = await seeded(t);
  const read = (query) => f.get(`/api/logs/records?kind=session&id=s1-aaaa&${query}`);
  const q = async (word, type = "all") =>
    (await read(`type=${type}&q=${encodeURIComponent(word)}`)).body;

  const pensive = await q("先想");
  assert.deepEqual(idsOf(pensive.records), [ids.reasoning]);
  assert.deepEqual(pensive.compactions, []);
  const command = await q("命令");
  assert.deepEqual(command.records, []);
  assert.deepEqual(idsOf(command.compactions), [ids.compaction]);
  assert.deepEqual(idsOf((await q("LS -LA")).records), [ids.call]); // 工具参数，不区分大小写
  assert.deepEqual(idsOf((await q("file_a")).records), [ids.output]); // 工具返回
  assert.deepEqual(idsOf((await q("%")).records), [ids.answer1]); // 字面量 %
  assert.deepEqual(idsOf((await q("_")).records), [ids.output]);
  assert.deepEqual((await q("%", "summary")).compactions, []);
  assert.deepEqual(idsOf((await q("摘要", "summary")).compactions), [ids.compaction]);
  // 类型与关键字同时生效；非 all/summary 类型不返回压缩。
  assert.deepEqual(idsOf((await q("命令", "tool")).records), []);
  assert.deepEqual((await q("命令", "tool")).compactions, []);

  // 分页：最新的 3 条升序返回；before 取更早的；压缩在每一页都完整返回。
  const page1 = (await read("limit=3")).body;
  assert.deepEqual(idsOf(page1.records), [ids.answer1, ids.user2, ids.answer2]);
  assert.equal(page1.has_more, true);
  assert.deepEqual(idsOf(page1.compactions), [ids.compaction]);
  const page2 = (await read(`limit=3&before=${ids.answer1}`)).body;
  assert.deepEqual(idsOf(page2.records), [ids.reasoning, ids.call, ids.output]);
  assert.equal(page2.has_more, true);
  assert.deepEqual(idsOf(page2.compactions), [ids.compaction]);
  const page3 = (await read(`limit=3&before=${ids.reasoning}`)).body;
  assert.deepEqual(idsOf(page3.records), [ids.user1]);
  assert.equal(page3.has_more, false);
  assert.equal((await read("limit=7")).body.has_more, false);
  assert.equal((await read("limit=6")).body.has_more, true);
  // 过滤后的分页：只有两条用量记录，limit=1 时还有更多。
  const usagePage = (await read("type=usage&limit=1")).body;
  assert.deepEqual(idsOf(usagePage.records), [ids.answer2]);
  assert.equal(usagePage.has_more, true);
});

test("records：压缩记录字段与计量，对话汇总不含子任务，子任务只含自身", async (t) => {
  const { f, ids } = await seeded(t);
  const session = (await f.get("/api/logs/records?kind=session&id=s1-aaaa")).body;
  assert.deepEqual(session.compactions, [
    {
      id: ids.compaction,
      session_id: "s1-aaaa",
      task_id: null,
      through_id: ids.output,
      summary: "早期摘要：讨论了 ls 命令",
      usage: { input_tokens: 3, output_tokens: 4 },
      metering: priced("claude-sonnet-5-5", 0.25),
      created_at: 2500,
    },
  ]);
  // 汇总：对话自己的 3 次请求（两条消息和一次压缩），不含子任务 t1，且不受 type 与分页影响。
  assert.equal(session.summary.requests, 3);
  assert.deepEqual(session.summary.cost, { amount: 0.75, currency: "USD", unpriced_requests: 1 });
  assert.deepEqual(session.summary.tokens, {
    input_tokens: 113,
    output_tokens: 74,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 7,
    total_tokens: 150,
  });
  assert.deepEqual(
    session.summary.models.map((model) => [model.model, model.requests]),
    [
      ["claude-sonnet-5-5", 2],
      ["gpt-5", 1],
    ],
  );
  const narrowed = (
    await f.get(`/api/logs/records?kind=session&id=s1-aaaa&type=reasoning&q=x&limit=1`)
  ).body;
  assert.deepEqual(narrowed.summary, session.summary);
  // owner.cost 仍是含子任务的累计口径，与 summary 是两回事。
  assert.equal(session.owner.cost.amount, 0.9375);

  const task = (await f.get("/api/logs/records?kind=task&id=t1-xxxx")).body;
  assert.equal(task.owner.kind, "task");
  assert.equal(task.owner.session_id, "s1-aaaa");
  assert.equal(task.owner.session_title, "对话一");
  assert.deepEqual(idsOf(task.records), [ids.taskUser, ids.taskAnswer, ids.taskImage]);
  assert.ok(
    task.records.every((record) => record.session_id === null && record.task_id === "t1-xxxx"),
  );
  assert.equal(task.records[1].metering.cost.amount, 0.125);
  // 子任务汇总含自己的压缩（2 次请求），不含所属对话。
  assert.equal(task.summary.requests, 2);
  assert.deepEqual(task.summary.cost, { amount: 0.1875, currency: "USD", unpriced_requests: 0 });
  assert.deepEqual(task.summary.tokens, { input_tokens: 3, output_tokens: 3 });
  assert.deepEqual(task.compactions, [
    {
      id: ids.taskCompaction,
      session_id: null,
      task_id: "t1-xxxx",
      through_id: ids.taskUser,
      summary: "任务摘要",
      usage: { input_tokens: 2, output_tokens: 1 },
      metering: priced("claude-haiku-5-5", 0.0625),
      created_at: 4420,
    },
  ]);
  // 对话的压缩列表不会混入子任务的压缩。
  assert.deepEqual(idsOf(session.compactions), [ids.compaction]);

  // 没有任何请求的对话：汇总为空，不报错。
  const empty = (await f.get("/api/logs/records?kind=session&id=s4-dddd")).body;
  assert.deepEqual(empty.records, []);
  assert.deepEqual(empty.summary, {
    requests: 0,
    cost: { amount: 0, currency: "USD", unpriced_requests: 0 },
    tokens: {},
    models: [],
  });
});

test("records：形态各异的记录（纯字符串、混杂数组、无正文）搜索不会报错", async (t) => {
  const { f, ids } = await seeded(t);
  const read = async (word) => {
    const result = await f.get(
      `/api/logs/records?kind=session&id=s2-bbbb&q=${encodeURIComponent(word)}`,
    );
    assert.equal(result.status, 200, word);
    return idsOf(result.body.records);
  };
  assert.deepEqual(await read("STR"), [ids.stringContent]);
  assert.deepEqual(await read("mixed"), [ids.mixedContent]);
  assert.deepEqual(await read("C:\\temp"), [ids.special]);
  assert.deepEqual(await read("不存在"), []);
  // 不带关键字时全部返回，包括没有任何正文字段的记录。
  const all = await f.get("/api/logs/records?kind=session&id=s2-bbbb");
  assert.deepEqual(idsOf(all.body.records), [
    ids.special,
    ids.stringContent,
    ids.mixedContent,
    ids.unknown,
  ]);
});

test("records：未知记录与类型不匹配返回 404，非法参数返回 400", async (t) => {
  const { f } = await seeded(t);
  assert.equal((await f.get("/api/logs/records?kind=session&id=missing")).status, 404);
  assert.equal((await f.get("/api/logs/records?kind=task&id=s1-aaaa")).status, 404);
  assert.equal((await f.get("/api/logs/records?kind=session&id=t1-xxxx")).status, 404);
  const missing = await f.get("/api/logs/records?kind=session&id=missing");
  assert.match(missing.body.error, /记录不存在/);
  for (const bad of [
    "id=s1-aaaa",
    "kind=other&id=s1-aaaa",
    "kind=session",
    "kind=session&id=",
    "kind=session&id=s1-aaaa&type=other",
    "kind=session&id=s1-aaaa&limit=0",
    "kind=session&id=s1-aaaa&limit=501",
    "kind=session&id=s1-aaaa&limit=abc",
    "kind=session&id=s1-aaaa&before=-1",
    "kind=session&id=s1-aaaa&before=x",
    `kind=session&id=s1-aaaa&q=${"x".repeat(201)}`,
  ]) {
    assert.equal((await f.get(`/api/logs/records?${bad}`)).status, 400, bad);
  }
  assert.equal((await f.get("/api/logs/records?kind=session&id=s1-aaaa&limit=500")).status, 200);
});

test("路由：只支持 GET，未知路径 404，未登录 401", async (t) => {
  const { f } = await seeded(t);
  for (const route of [
    "/api/logs/summary",
    "/api/logs/owners",
    "/api/logs/records?kind=session&id=s1-aaaa",
  ]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await f.request(route, method)).status, 405, `${method} ${route}`);
    }
    assert.equal((await fetch(f.origin + route)).status, 401, route);
  }
  for (const route of [
    "/api/logs",
    "/api/logs/unknown",
    "/api/logs/summary/extra",
    "/api/logs/owners/s1-aaaa",
    "/api/logs/records/extra",
  ]) {
    const response = await f.request(route);
    assert.equal(response.status, 404, route);
    assert.match((await response.json()).error, /接口不存在/);
  }
});
