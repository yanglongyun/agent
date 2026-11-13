import { configured } from "./config-fixture.js";
import { runReply } from "./events.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildChatPayload, normalizeChat, readChatStream } from "../ai/chat.js";
import { callModel, message } from "../ai/index.js";
import { defaults, paths, validateConfig } from "../config.js";
import { createServer } from "../index.js";
import compact from "../agent/compact.js";
import ask from "../scripts/ask.js";
import modelServer from "./model.js";

const config = {
  ...defaults(),
  protocol: "chat-completions",
  model: "gpt-6-luna",
  url: "https://test.invalid/v1/chat/completions",
  key: "test-key",
};
const usage = {
  prompt_tokens: 1000,
  completion_tokens: 100,
  total_tokens: 1100,
  prompt_tokens_details: { cached_tokens: 200 },
  completion_tokens_details: { reasoning_tokens: 50 },
};
const tool = {
  type: "function",
  name: "read",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  strict: true,
};
const call = (id = "call_a") => ({
  type: "function_call",
  call_id: id,
  name: "read",
  arguments: '{"path":"a.txt"}',
});
const result = (id = "call_a", output = "proof") => ({
  type: "function_call_output",
  call_id: id,
  output,
});
const reply = (content = "你好", calls = []) => ({
  id: "chatcmpl_test",
  model: config.model,
  usage,
  choices: [
    {
      index: 0,
      finish_reason: calls.length ? "tool_calls" : "stop",
      message: { role: "assistant", content, ...(calls.length ? { tool_calls: calls } : {}) },
    },
  ],
});
const nativeCall = (id = "call_a") => ({
  id,
  type: "function",
  function: { name: "read", arguments: '{"path":"a.txt"}' },
});
const chunk = (delta, finish_reason = null) => ({
  id: "chatcmpl_test",
  model: config.model,
  choices: [{ index: 0, delta, finish_reason }],
});
const streamBody = (events, done = true) =>
  events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") +
  (done ? "data: [DONE]\r\n\r\n" : "");

async function endpoint(t, respond) {
  const errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const bytes of req) {
        raw += bytes;
      }
      const body = JSON.parse(raw);
      const completion = await respond(body, req);
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const choice = completion.choices[0];
        const events = [
          chunk(choice.message),
          chunk({}, choice.finish_reason),
          { ...completion, choices: [] },
        ];
        // 工具 delta 通过 index 标识所属调用。
        if (events[0].choices[0].delta.tool_calls) {
          events[0].choices[0].delta = {
            ...choice.message,
            tool_calls: choice.message.tool_calls.map((call, index) => ({ ...call, index })),
          };
        }
        res.end(streamBody(events));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(completion));
      }
    } catch (error) {
      errors.push(error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    if (errors.length) {
      throw errors[0];
    }
  });
  return `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
}

test("Chat 序列化消息、图片、并行工具和定义，不修改内部历史", () => {
  const messages = [
    message("开始"),
    message("先读文件", "output_text", "assistant"),
    call(),
    call("call_b"),
    result(),
    result("call_b"),
    {
      ...message("图片"),
      content: [{ type: "input_image", image_url: "https://example.com/a.png", detail: "high" }],
    },
  ];
  const before = structuredClone(messages);
  const payload = buildChatPayload({
    instructions: "系统指令",
    messages,
    model: config.model,
    config,
    tools: [tool],
    stream: true,
  });
  assert.equal(payload.messages[0].content, "系统指令");
  assert.deepEqual(
    payload.messages[2].tool_calls.map((call) => call.id),
    ["call_a", "call_b"],
  );
  assert.deepEqual(payload.messages[2].content, [{ type: "text", text: "先读文件" }]);
  assert.deepEqual(payload.messages[3], { role: "tool", tool_call_id: "call_a", content: "proof" });
  assert.deepEqual(payload.messages.at(-1).content[0], {
    type: "image_url",
    image_url: { url: "https://example.com/a.png", detail: "high" },
  });
  assert.deepEqual(payload.tools[0], {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    },
  });
  assert.deepEqual(payload.stream_options, { include_usage: true });
  assert.equal(payload.reasoning_effort, "none");
  assert.deepEqual(messages, before);
});

test("Chat 工具图片在所有工具结果之后传给视觉输入，原消息仍是工具结果", () => {
  const messages = [
    message("查看"),
    call(),
    call("call_b"),
    result("call_a", [
      { type: "input_text", text: "image" },
      { type: "input_image", image_url: "data:image/png;base64,YQ==" },
    ]),
    result("call_b"),
  ];
  const before = structuredClone(messages);
  const payload = buildChatPayload({ messages, model: config.model, config });
  assert.deepEqual(
    payload.messages.map((entry) => entry.role),
    ["user", "assistant", "tool", "tool", "user"],
  );
  assert.equal(payload.messages.at(-1).content[1].image_url.url, "data:image/png;base64,YQ==");
  assert.deepEqual(messages, before);
});

test("Chat 思考文本只回送相同端点与模型，Claude 签名和 Responses 思考不跨协议发送", () => {
  const completion = reply("答案", [nativeCall()]);
  completion.choices[0].message.reasoning_content = "先检查";
  const normalized = normalizeChat(completion, { source: config.url, model: config.model });
  const messages = [message("问题"), ...normalized.output, result()];
  const payload = buildChatPayload({ messages, model: config.model, config });
  assert.equal(payload.messages[1].reasoning_content, "先检查");
  for (const target of [
    { ...config, model: "other" },
    { ...config, url: "https://other.invalid" },
  ]) {
    assert.equal(
      buildChatPayload({ messages, model: target.model, config: target }).messages[1]
        .reasoning_content,
      undefined,
    );
  }
  const foreign = {
    type: "reasoning",
    summary: [{ type: "summary_text", text: "foreign" }],
    native: { protocol: "anthropic-messages", block: { signature: "opaque" } },
  };
  assert.deepEqual(
    buildChatPayload({ messages: [message("问题"), foreign], model: config.model, config })
      .messages,
    [{ role: "user", content: [{ type: "text", text: "问题" }] }],
  );
});

test("Chat 拒绝孤儿结果、重复调用、未完成工具组和非 JSON 参数", () => {
  for (const messages of [
    [result()],
    [call()],
    [call(), result(), call(), result()],
    [call(), call("b"), result(), message("next"), result("b")],
    [{ ...call(), arguments: {} }],
  ]) {
    assert.throws(() => buildChatPayload({ messages, model: config.model, config }), {
      code: "invalid_request",
    });
  }
});

for (const stream of [false, true]) {
  test(`Chat ${stream ? "流式" : "非流式"}真实 HTTP，保留原始 usage 并按 Chat 字段计费`, async (t) => {
    const url = await endpoint(t, (body, req) => {
      assert.equal(req.headers.authorization, "Bearer test-key");
      assert.equal(body.model, config.model);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.instructions, undefined);
      assert.equal(body.input, undefined);
      assert.equal(body.stream_options?.include_usage, stream ? true : undefined);
      return reply();
    });
    const events = [];
    const response = await callModel(
      "指令",
      [message("问题")],
      config.model,
      { ...config, url },
      [],
      stream ? (event) => events.push(event) : undefined,
    );
    assert.equal(response.status, "completed");
    assert.equal(response.output[0].content[0].text, "你好");
    assert.deepEqual(response.usage, usage);
    assert.equal(response.usage.input_tokens, undefined);
    assert.equal(response.metering.context_tokens, 1100);
    assert.equal(response.metering.cost.amount, 0.000132);
    assert.deepEqual(
      events.map((event) => event.delta),
      stream ? ["你好"] : [],
    );
  });
}

test("Chat 逐字节 CRLF 流拼接并行工具参数，结束后继续读取 usage", async () => {
  const events = [
    chunk({ role: "assistant", reasoning_content: "先检查" }),
    chunk({ content: "你好" }),
    chunk({
      tool_calls: [
        { index: 0, id: "a", type: "function", function: { name: "read", arguments: '{"pa' } },
        { index: 1, id: "b", type: "function", function: { name: "read", arguments: '{"path":' } },
      ],
    }),
    chunk(
      {
        tool_calls: [
          { index: 1, function: { arguments: '"b.txt"}' } },
          { index: 0, function: { arguments: 'th":"a.txt"}' } },
        ],
      },
      "tool_calls",
    ),
    { id: "chatcmpl_test", model: config.model, choices: [], usage },
  ];
  const body = new ReadableStream({
    start(controller) {
      for (const byte of new TextEncoder().encode(streamBody(events))) {
        controller.enqueue(Uint8Array.of(byte));
      }
      controller.close();
    },
  });
  const received = [];
  const response = await readChatStream(body, {
    source: config.url,
    model: config.model,
    onEvent: (event) => received.push(event),
  });
  assert.deepEqual(
    response.output.map((item) => item.type),
    ["reasoning", "message", "function_call", "function_call"],
  );
  assert.deepEqual(
    response.output.slice(2).map((item) => [item.call_id, item.arguments]),
    [
      ["a", '{"path":"a.txt"}'],
      ["b", '{"path":"b.txt"}'],
    ],
  );
  assert.deepEqual(response.usage, usage);
  assert.deepEqual(received, [
    { type: "reasoning", delta: "先检查" },
    { type: "message", delta: "你好" },
  ]);
});

test("Chat 断流、错误 JSON、缺少结束原因和残缺工具不能作为成功回复", async () => {
  for (const [raw, code] of [
    [streamBody([chunk({ content: "partial" }, "stop")], false), "stream_interrupted"],
    [streamBody([chunk({ role: "assistant" })]), "stream_interrupted"],
    ["data: broken\n\ndata: [DONE]\n\n", "invalid_response"],
    [
      streamBody([
        chunk(
          {
            tool_calls: [
              { index: 0, type: "function", function: { name: "read", arguments: "{}" } },
            ],
          },
          "tool_calls",
        ),
      ]),
      "invalid_response",
    ],
    [
      streamBody([chunk({ function_call: { name: "read", arguments: "{}" } }, "function_call")]),
      "invalid_response",
    ],
    [streamBody([chunk({}, "content_filter")]), "response_failed"],
  ]) {
    await assert.rejects(
      readChatStream(new Response(raw).body, { source: config.url, model: config.model }),
      { code },
    );
  }
  const incomplete = await readChatStream(
    new Response(
      streamBody([
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                id: "a",
                type: "function",
                function: { name: "read", arguments: '{"path":' },
              },
            ],
          },
          "length",
        ),
      ]),
    ).body,
    { source: config.url, model: config.model },
  );
  assert.equal(incomplete.status, "incomplete");
  assert.deepEqual(incomplete.output, []);
});

test("Chat 取消等待中的流会释放读取器", async () => {
  const controller = new AbortController();
  let canceled = false;
  const body = new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode(streamBody([chunk({ role: "assistant" })], false)));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(
    readChatStream(body, {
      source: config.url,
      model: config.model,
      signal: controller.signal,
      onActivity: () => controller.abort(),
    }),
    { name: "AbortError" },
  );
  assert.equal(canceled, true);
});

test("Chat 收到工具参数后断流不自动重试", async (t) => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      streamBody(
        [
          chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "a",
                type: "function",
                function: { name: "read", arguments: '{"path":' },
              },
            ],
          }),
        ],
        false,
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await assert.rejects(
    callModel(
      "",
      [message("read")],
      config.model,
      { ...config, url: `http://127.0.0.1:${server.address().port}` },
      [],
      () => {},
    ),
    { code: "stream_interrupted" },
  );
  assert.equal(requests, 1);
});

test("Chat Web 与 CLI 的工具循环都保存标准消息、原始 usage 和计量", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-chat-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "a.txt"), "proof");
  let requests = 0;
  const url = await endpoint(t, (body) => {
    requests++;
    assert.equal(body.tools.length, 6);
    if (body.messages.at(-1).role !== "tool") {
      return reply(null, [nativeCall()]);
    }
    assert.equal(body.messages.at(-1).tool_call_id, "call_a");
    assert.ok(body.messages.at(-1).content.includes("proof"));
    return reply("完成");
  });
  const locations = paths({ AGENT_HOME: root });
  const target = configured(
    { model: config.model, key: config.key, protocol: config.protocol, url },
    { workdir: root, api: { listen: "127.0.0.1:0", token: "chat-test-access-token" } },
  );
  validateConfig(target);
  const runtime = createServer({ p: locations, config: target });
  const origin = await runtime.listen();
  t.after(() => runtime.close());
  const headers = {
    authorization: `Bearer ${target.api.token}`,
    "content-type": "application/json",
  };
  const session = await (
    await fetch(origin + "/api/sessions", { method: "POST", headers, body: "{}" })
  ).json();
  const request = (route, method = "GET", data) =>
    fetch(origin + route, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const events = await runReply(request, `/api/sessions/${session.id}/messages`, {
    text: "读文件",
  });
  assert.equal(events.at(-1).status, "completed");
  const records = await (
    await fetch(`${origin}/api/sessions/${session.id}/messages`, { headers })
  ).json();
  assert.deepEqual(
    records.messages.map((row) => row.item.type),
    ["message", "function_call", "function_call_output", "message"],
  );
  assert.deepEqual(
    records.messages.filter((row) => row.usage).map((row) => row.usage),
    [usage, usage],
  );
  assert.ok(
    records.messages
      .filter((row) => row.usage)
      .every(
        (row) =>
          row.metering.protocol === "chat-completions" && row.metering.cost.amount === 0.000132,
      ),
  );
  const write = process.stdout.write;
  const errorWrite = process.stderr.write;
  let cli;
  try {
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    cli = await ask("读文件", target, { locations, modelId: "main", compactModelId: "compact" });
  } finally {
    process.stdout.write = write;
    process.stderr.write = errorWrite;
  }
  assert.equal(cli.status, "completed");
  assert.equal(requests, 4);
  assert.equal(
    runtime.db.prepare("SELECT COUNT(*) n FROM metering WHERE session_id=?").get(cli.session_id).n,
    2,
  );
});

test("Chat 压缩请求也转换消息并保留独立用量", async (t) => {
  const url = await endpoint(t, (body) => {
    assert.equal(body.tools, undefined);
    assert.equal(body.messages[0].role, "system");
    return reply("交接摘要");
  });
  const response = await compact(
    [message("一"), message("二"), message("三"), message("四")],
    config.model,
    { ...config, url, keep: 1 },
  );
  assert.ok(response.item.content[0].text.includes("交接摘要"));
  assert.deepEqual(response.usage, usage);
  assert.equal(response.metering.cost.amount, 0.000132);
});

test("Chat 图片工具经过文件展开后发送视觉输入，数据库不产生额外用户消息或 Base64", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-chat-image-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await fs.writeFile(path.join(root, "a.png"), Buffer.from(image, "base64"));
  let requests = 0;
  const url = await endpoint(t, (body) => {
    requests++;
    if (requests === 1) {
      const call = nativeCall();
      call.function.arguments = '{"path":"a.png"}';
      return reply(null, [call]);
    }
    assert.equal(requests, 2);
    assert.equal(body.messages.at(-2).role, "tool");
    assert.equal(body.messages.at(-1).role, "user");
    assert.equal(body.messages.at(-1).content[1].image_url.url, `data:image/png;base64,${image}`);
    return reply("已查看图片");
  });
  const target = configured(
    { model: config.model, key: config.key, protocol: config.protocol, url },
    { workdir: root, api: { listen: "127.0.0.1:0", token: "chat-image-test-token" } },
  );
  const runtime = createServer({ p: paths({ AGENT_HOME: root }), config: target });
  const origin = await runtime.listen();
  t.after(() => runtime.close());
  const headers = {
    authorization: `Bearer ${target.api.token}`,
    "content-type": "application/json",
  };
  const session = await (
    await fetch(origin + "/api/sessions", { method: "POST", headers, body: "{}" })
  ).json();
  const request = (route, method = "GET", data) =>
    fetch(origin + route, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const events = await runReply(request, `/api/sessions/${session.id}/messages`, {
    text: "看图片",
  });
  const text = JSON.stringify(events);
  assert.equal(events.at(-1).status, "completed");
  assert.equal(text.includes("data:image/"), false);
  const rows = runtime.db
    .prepare("SELECT item FROM messages WHERE session_id=? ORDER BY id")
    .all(session.id)
    .map((row) => JSON.parse(row.item));
  assert.equal(rows.filter((item) => item.role === "user").length, 1);
  const result = rows.find((item) => item.type === "function_call_output");
  assert.match(result.output[1].image_url, /^\/api\/images\//);
  assert.equal(JSON.stringify(rows).includes("data:image/"), false);
});

test("设置跨协议压缩模型，过期从保存的模型时间判断，摘要与费用先入库再续聊", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-expiry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let summaries = 0;
  const summaryUsage = { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 };
  const compactURL = await modelServer(t, (body) => {
    summaries++;
    assert.equal(body.model, "gpt-6-luna");
    assert.deepEqual(body.tools, []);
    return { output: [message("独立模型的摘要", "output_text", "assistant")], usage: summaryUsage };
  });
  let runtime;
  const url = await endpoint(t, (body, req) => {
    assert.equal(body.model, "gpt-6.1-terra");
    assert.equal(req.headers.authorization, "Bearer main-key");
    if (summaries) {
      const saved = runtime.db.prepare("SELECT * FROM compactions").all();
      assert.equal(saved.length, 1);
      assert.ok(
        body.messages.some(
          (item) =>
            Array.isArray(item.content) &&
            item.content.some((part) => part.text?.includes("独立模型的摘要")),
        ),
      );
      const meter = runtime.db
        .prepare("SELECT measurement FROM metering WHERE compaction_id = ?")
        .get(saved[0].id);
      assert.equal(JSON.parse(meter.measurement).cost.amount, 0.00015);
    }
    return reply("回答");
  });
  const target = configured(
    {
      model: config.model,
      key: config.key,
      protocol: config.protocol,
      model: "gpt-6.1-terra",
      url,
      key: "main-key",
    },
    { keep: 1, api: { listen: "127.0.0.1:0", token: "expiry-test-access-token" } },
  );
  const locations = paths({ AGENT_HOME: root });
  runtime = createServer({ p: locations, config: target });
  const origin = await runtime.listen();
  t.after(() => runtime.close());
  const headers = {
    authorization: `Bearer ${target.api.token}`,
    "content-type": "application/json",
  };
  const request = (route, method = "GET", body) =>
    fetch(origin + route, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const summary = {
    ...target.models[0],
    id: "summary",
    name: "独立摘要模型",
    model: "gpt-6-luna",
    url: compactURL,
    key: "summary-key",
    protocol: "responses",
  };
  const patch = {
    models: [...target.models, summary],
    compact_on_cache_expiry: true,
    cache_ttl: 300,
  };
  assert.equal((await request("/api/config", "PUT", patch)).status, 200);
  const view = await (await request("/api/config")).json();
  assert.equal(view.models.at(-1).key, undefined);
  assert.equal(view.models.at(-1).key_set, true);
  assert.equal(view.compact_on_cache_expiry, true);
  assert.equal(
    (
      await request("/api/config", "PUT", {
        models: patch.models.map((model) => ({ ...model, key: "" })),
      })
    ).status,
    200,
  );
  const savedConfig = JSON.parse(await fs.readFile(locations.config, "utf8"));
  assert.equal(savedConfig.models.at(-1).key, "summary-key");
  assert.equal(
    (await request("/api/config", "PUT", { compact_on_cache_expiry: "true" })).status,
    400,
  );
  const session = await (await request("/api/sessions", "POST", {})).json();
  const route = `/api/sessions/${session.id}/messages`;
  for (let i = 0; i < 3; i++) {
    const raw = JSON.stringify(
      await runReply(request, route, {
        model_id: "main",
        compact_model_id: "summary",
        text: `问题${i}`,
      }),
    );
    assert.ok(raw.includes('"status":"completed"'));
  }
  assert.equal(summaries, 0);
  // 用户消息在请求时刚保存；不能用它刷新模型缓存的计时。
  runtime.db
    .prepare("UPDATE messages SET created_at = ? WHERE id = (SELECT MAX(id) FROM messages)")
    .run(Date.now() - 300001);
  const events = await runReply(request, route, {
    model_id: "main",
    compact_model_id: "summary",
    text: "过期后继续",
  });
  const response = JSON.stringify(events);
  assert.equal(events.at(-1).status, "completed", response);
  assert.equal(summaries, 1);
  const compressed = events.find(
    (event) => event.type === "compact" && event.status === "completed",
  );
  assert.equal(compressed.compaction.metering.model, "gpt-6-luna");
  assert.equal(compressed.compaction.metering.protocol, "responses");
  assert.deepEqual(compressed.compaction.usage, summaryUsage);
  assert.equal(runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 8);
  const mainMeter = events.find((event) => event.type === "usage").metering;
  assert.equal(mainMeter.model, "gpt-6.1-terra");
  assert.equal(mainMeter.protocol, "chat-completions");
  assert.equal(mainMeter.cost.amount, 0.00131);
  const resumed = JSON.stringify(
    await runReply(request, route, {
      model_id: "main",
      compact_model_id: "summary",
      text: "刚响应后继续",
    }),
  );
  assert.ok(resumed.includes('"status":"completed"'));
  assert.equal(summaries, 1);
});

test("Gemini 无 index 的并行工具按原始 ID 关联，stop 正常结束，签名随原工具回送", async () => {
  const model = "gemini-4-carbon";
  const extra = { google: { thought_signature: "gemini-signature" } };
  const raw = streamBody([
    chunk({
      role: "assistant",
      tool_calls: [
        { ...nativeCall("b"), extra_content: extra },
        { ...nativeCall("a"), function: { name: "read", arguments: '{"path":"b.txt"}' } },
      ],
    }),
    chunk({}, "stop"),
    { id: "chatcmpl_test", model, choices: [], usage },
  ]);
  const response = await readChatStream(new Response(raw).body, { source: config.url, model });
  assert.equal(response.status, "completed");
  assert.deepEqual(
    response.output.map((item) => item.call_id),
    ["b", "a"],
  );
  assert.deepEqual(response.usage, usage);
  assert.deepEqual(response.output[0].native.block.extra_content, extra);
  const messages = [message("read"), ...response.output, result("b"), result("a")];
  const original = structuredClone(messages);
  const payload = buildChatPayload({ messages, model, config, tools: [tool] });
  assert.deepEqual(payload.messages[1].tool_calls[0].extra_content, extra);
  assert.equal(payload.messages[1].tool_calls[1].extra_content, undefined);
  assert.deepEqual(
    payload.messages.slice(2).map((item) => item.tool_call_id),
    ["b", "a"],
  );
  for (const target of [
    { model: "gemini-other", url: config.url },
    { model, url: "https://other.invalid/chat/completions" },
    { model: config.model, url: config.url },
  ]) {
    const changed = buildChatPayload({
      messages,
      model: target.model,
      config: { ...config, url: target.url },
    });
    assert.equal(changed.messages[1].tool_calls[0].extra_content, undefined);
  }
  assert.deepEqual(messages, original);
});

test("Gemini 索引参数分片保留签名，非流式签名与文本扩展也能原样往返", async () => {
  const model = "gemini-4-carbon";
  const extra = { google: { thought_signature: "signed-tool" } };
  const parsed = await readChatStream(
    new Response(
      streamBody([
        chunk({
          tool_calls: [
            { index: 0, id: "a", type: "function", function: { name: "read", arguments: '{"pa' } },
          ],
        }),
        chunk(
          {
            tool_calls: [
              { index: 0, function: { arguments: 'th":"a.txt"}' }, extra_content: extra },
            ],
          },
          "stop",
        ),
      ]),
    ).body,
    { source: config.url, model },
  );
  assert.equal(parsed.output[0].arguments, '{"path":"a.txt"}');
  assert.deepEqual(parsed.output[0].native.block.extra_content, extra);
  const completion = reply("先读文件", [{ ...nativeCall("b"), extra_content: extra }]);
  completion.model = model;
  completion.choices[0].finish_reason = "stop";
  completion.choices[0].message.extra_content = { google: { thought_signature: "signed-text" } };
  const normalized = normalizeChat(completion, { source: config.url, model });
  const payload = buildChatPayload({
    messages: [message("read"), ...normalized.output, result("b")],
    model,
    config,
  });
  assert.deepEqual(payload.messages[1].extra_content, completion.choices[0].message.extra_content);
  assert.deepEqual(payload.messages[1].tool_calls[0].extra_content, extra);
  normalized.output[1].arguments = '{"path":"changed.txt"}';
  const changed = buildChatPayload({
    messages: [message("read"), ...normalized.output, result("b")],
    model,
    config,
  });
  assert.equal(changed.messages[1].tool_calls[0].extra_content, undefined);
});

test("Gemini 不猜测缺失 ID 或非法索引，不接受残缺参数；其他 Chat 模型保持严格校验", async () => {
  const full = nativeCall("a");
  for (const [model, toolCall, finish] of [
    ["gemini-4-carbon", { type: "function", function: full.function }, "stop"],
    ["gemini-4-carbon", { ...full, index: -1 }, "stop"],
    ["gemini-4-carbon", { ...full, index: null }, "stop"],
    ["gemini-4-carbon", { ...full, function: { name: "read", arguments: '{"path":' } }, "stop"],
    ["gemini-4-carbon", { ...full, id: "" }, "stop"],
    [config.model, full, "tool_calls"],
    [config.model, { ...full, index: 0 }, "stop"],
  ]) {
    await assert.rejects(
      readChatStream(new Response(streamBody([chunk({ tool_calls: [toolCall] }, finish)])).body, {
        source: config.url,
        model,
      }),
      { code: "invalid_response" },
    );
  }
});

test("Gemini Web 与 CLI 实际执行工具，原始签名落库后在后续请求中保留", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-gemini-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "a.txt"), "gemini-proof");
  let steps = 0;
  const errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const bytes of req) {
        raw += bytes;
      }
      const body = JSON.parse(raw);
      let events;
      if (body.messages.at(-1).role !== "tool") {
        events = [
          chunk({
            role: "assistant",
            tool_calls: [
              {
                ...nativeCall("gemini-call"),
                extra_content: { google: { thought_signature: "exact-signature" } },
              },
            ],
          }),
          chunk({}, "stop"),
        ];
      } else {
        const native = body.messages.findLast((item) => item.tool_calls).tool_calls[0];
        assert.equal(native.id, "gemini-call");
        assert.equal(native.extra_content.google.thought_signature, "exact-signature");
        assert.match(body.messages.at(-1).content, /gemini-proof/);
        steps++;
        events = [chunk({ role: "assistant", content: "检查完成" }, "stop")];
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        streamBody([...events, { id: "chatcmpl_test", model: body.model, choices: [], usage }]),
      );
    } catch (error) {
      errors.push(error);
      res.writeHead(400);
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    assert.deepEqual(errors, []);
  });
  const locations = paths({ AGENT_HOME: root });
  const target = configured(
    {
      model: config.model,
      key: config.key,
      protocol: config.protocol,
      model: "gemini-4-carbon",
      url: `http://127.0.0.1:${server.address().port}/chat/completions`,
    },
    { workdir: root, api: { listen: "127.0.0.1:0", token: "gemini-test-access-token" } },
  );
  const runtime = createServer({ p: locations, config: target });
  t.after(() => runtime.close());
  const origin = await runtime.listen();
  const headers = {
    authorization: `Bearer ${target.api.token}`,
    "content-type": "application/json",
  };
  const session = await (
    await fetch(origin + "/api/sessions", { method: "POST", headers, body: "{}" })
  ).json();
  const request = (route, method = "GET", data) =>
    fetch(origin + route, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const events = await runReply(request, `/api/sessions/${session.id}/messages`, {
    text: "读取文件",
  });
  assert.equal(events.at(-1).status, "completed");
  assert.equal(
    events.some((event) => event.type === "error"),
    false,
  );
  const stored = runtime.db
    .prepare(
      "SELECT item FROM messages WHERE session_id = ? AND json_extract(item,'$.type') = 'function_call'",
    )
    .get(session.id);
  assert.equal(
    JSON.parse(stored.item).native.block.extra_content.google.thought_signature,
    "exact-signature",
  );
  const write = process.stdout.write;
  const errorWrite = process.stderr.write;
  let cli;
  try {
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    cli = await ask("读取文件", target, { locations, modelId: "main", compactModelId: "compact" });
  } finally {
    process.stdout.write = write;
    process.stderr.write = errorWrite;
  }
  assert.equal(cli.status, "completed");
  assert.equal(steps, 2);
});
