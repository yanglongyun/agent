import { configured } from "./config-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { callModel, message } from "../ai/index.js";
import { buildClaudePayload, normalizeClaude, readClaudeStream } from "../ai/claude.js";
import { defaults, validateConfig } from "../config.js";
import { appendEnvironment, captureEnvironment } from "../environment.js";

const user = (text) => message(text);
const call = (id) => ({
  type: "function_call",
  call_id: id,
  name: "lookup",
  arguments: '{"x":1}',
});
const result = (id) => ({ type: "function_call_output", call_id: id, output: "proof" });
const config = {
  ...defaults(),
  protocol: "anthropic-messages",
  url: "https://test.invalid/messages",
  key: "test-key",
  model: "claude-test",
};

function claudeEvents(content = [{ type: "text", text: "你好" }], reason = "end_turn") {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        role: "assistant",
        model: "upstream-claude",
        content: [],
        usage: { input_tokens: 3, cache_read_input_tokens: 10 },
      },
    },
  ];
  for (const [index, block] of content.entries()) {
    events.push({
      type: "content_block_start",
      index,
      content_block:
        block.type === "text"
          ? { type: "text", text: "" }
          : block.type === "tool_use"
            ? { ...block, input: {} }
            : { type: "thinking", thinking: "", signature: "" },
    });
    if (block.type === "text") {
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else if (block.type === "tool_use") {
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    } else if (block.type === "thinking") {
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "thinking_delta", thinking: block.thinking },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "signature_delta", signature: block.signature },
      });
    }
    events.push({ type: "content_block_stop", index });
  }
  events.push({
    type: "message_delta",
    delta: { stop_reason: reason },
    usage: { output_tokens: 2 },
  });
  events.push({ type: "message_stop" });
  return events;
}

function eventBody(events) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

test("Claude 前缀变化后不回送失效思考，正文与工具配对保留", () => {
  const tools = [{ type: "function", name: "lookup", parameters: { type: "object" } }];
  const initial = [user("开始")];
  const request = buildClaudePayload({
    instructions: "原始指令",
    messages: initial,
    model: config.model,
    config,
    tools,
  });
  const response = normalizeClaude(
    {
      id: "msg_bound",
      model: config.model,
      content: [
        { type: "thinking", thinking: "思考", signature: "bound-signature" },
        { type: "text", text: "查询中" },
        { type: "tool_use", id: "lookup_1", name: "lookup", input: { x: 1 } },
      ],
      stop_reason: "tool_use",
    },
    { source: config.url, model: config.model, request },
  );
  const history = [...initial, ...response.output, result("lookup_1")];
  const before = structuredClone(history);
  for (const change of [
    { instructions: "新指令" },
    { tools: [] },
    { messages: [user("摘要"), ...history.slice(1)] },
    { messages: [user("编辑后的输入"), ...history.slice(1)] },
  ]) {
    const payload = buildClaudePayload({
      instructions: "原始指令",
      messages: history,
      model: config.model,
      config,
      tools,
      ...change,
    });
    assert.deepEqual(
      payload.messages[1].content.map((block) => block.type),
      ["text", "tool_use"],
    );
    assert.equal(payload.messages[2].content[0].tool_use_id, "lookup_1");
  }
  const unchanged = buildClaudePayload({
    instructions: "原始指令",
    messages: history,
    model: config.model,
    config,
    tools,
  });
  assert.equal(unchanged.messages[1].content[0].signature, "bound-signature");
  assert.deepEqual(history, before);
});

for (const stream of [false, true]) {
  test(`Claude ${stream ? "流式" : "非流式"}保存后重放多个思考块，变更后可建立新前缀`, async (t) => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
      }
      requests.push(JSON.parse(raw));
      const content = [
        { type: "thinking", thinking: "", signature: `signed-${requests.length}` },
        { type: "text", text: "先查询" },
        { type: "redacted_thinking", data: `redacted-${requests.length}` },
        { type: "text", text: "回答" },
      ];
      if (stream) {
        // redacted_thinking 没有 delta，完整块在 start 中交付。
        const events = claudeEvents(content);
        for (const event of events) {
          if (event.type === "content_block_start" && event.index === 2) {
            event.content_block = content[2];
          }
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(eventBody(events));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `msg_${requests.length}`,
            model: config.model,
            content,
            stop_reason: "end_turn",
          }),
        );
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const target = { ...config, url: `http://127.0.0.1:${server.address().port}/messages` };
    const history = [user("开始")];
    for (const instructions of ["指令", "指令", "新指令", "新指令"]) {
      const response = await callModel(
        instructions,
        history,
        config.model,
        target,
        [],
        stream ? () => {} : undefined,
      );
      // 模拟消息 JSON 入库后重新读取，不依赖运行时对象身份。
      history.push(...JSON.parse(JSON.stringify(response.output)), user("继续"));
    }
    const thinking = (request) =>
      request.messages
        .flatMap((item) => item.content)
        .filter((block) => ["thinking", "redacted_thinking"].includes(block.type));
    assert.deepEqual(thinking(requests[1]), [
      { type: "thinking", thinking: "", signature: "signed-1" },
      { type: "redacted_thinking", data: "redacted-1" },
    ]);
    assert.deepEqual(thinking(requests[2]), []);
    assert.deepEqual(thinking(requests[3]), [
      { type: "thinking", thinking: "", signature: "signed-3" },
      { type: "redacted_thinking", data: "redacted-3" },
    ]);
  });
}

test("Claude 历史转换文本、工具、结果和签名原块", () => {
  const signature = "signed-thinking";
  const tools = [{ type: "function", name: "lookup", parameters: { type: "object" } }];
  const request = buildClaudePayload({
    instructions: "系统指令",
    messages: [user("开始")],
    model: config.model,
    config,
    tools,
  });
  const thinking = normalizeClaude(
    {
      id: "msg_thinking",
      content: [{ type: "thinking", thinking: "思考", signature }],
      stop_reason: "end_turn",
    },
    { source: config.url, model: config.model, request },
  ).output[0];
  const input = [user("开始"), thinking, call("a:1"), result("a:1"), user("继续")];
  const before = structuredClone(input);
  const payload = buildClaudePayload({
    instructions: "系统指令",
    messages: input,
    model: config.model,
    config,
    tools,
  });
  assert.equal(payload.system, "系统指令");
  assert.equal(payload.max_tokens, 64000);
  assert.equal(payload.stream, true);
  assert.deepEqual(payload.cache_control, { type: "ephemeral" });
  assert.equal(payload.tools[0].input_schema.type, "object");
  assert.equal(payload.messages[1].content[0].signature, signature);
  assert.equal(payload.messages[1].content[1].type, "tool_use");
  assert.equal(payload.messages[1].content[1].id, payload.messages[2].content[0].tool_use_id);
  assert.deepEqual(payload.messages[2].content[0].content, [{ type: "text", text: "proof" }]);
  assert.deepEqual(input, before);
});

test("Claude 签名只回送同一个端点和模型，其他协议不带原块", () => {
  const request = buildClaudePayload({ messages: [user("go")], model: config.model, config });
  const thinking = normalizeClaude(
    {
      id: "msg_thinking",
      content: [{ type: "thinking", thinking: "思考", signature: "signed-thinking" }],
      stop_reason: "end_turn",
    },
    { source: config.url, model: config.model, request },
  ).output[0];
  const input = [user("go"), thinking];
  assert(
    JSON.stringify(
      buildClaudePayload({ messages: input, model: config.model, config, tools: [] }),
    ).includes("signed-thinking"),
  );
  for (const target of [
    { ...config, model: "other" },
    { ...config, url: "https://other.invalid/messages" },
  ]) {
    assert(
      !JSON.stringify(
        buildClaudePayload({ messages: input, model: target.model, config: target }),
      ).includes("signed-thinking"),
    );
  }
});

test("Claude 拒绝孤儿结果、重复调用和残缺配对", () => {
  for (const input of [
    [call("a")],
    [result("a")],
    [call("a"), result("a"), call("a"), result("a")],
    [call("a"), call("b"), result("a"), user("next"), result("b")],
  ]) {
    assert.throws(() => buildClaudePayload({ messages: input, model: "m", config }), /tool|Tool/);
  }
});

test("Claude HTTP 请求头、SSE、usage 和统一输出", async (t) => {
  let requestBody;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
    }
    requestBody = JSON.parse(raw);
    assert.equal(req.headers["x-api-key"], "test-key");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers["anthropic-version"], "2023-06-01");
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      eventBody(
        claudeEvents(
          [
            { type: "thinking", thinking: "先检查", signature: "signed" },
            { type: "tool_use", id: "toolu_1", name: "lookup", input: { x: 1 } },
            { type: "text", text: "你好" },
          ],
          "tool_use",
        ),
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const deltas = [];
  const response = await callModel(
    "系统指令",
    [user("开始")],
    "claude-test",
    { ...config, url: `http://127.0.0.1:${server.address().port}/messages` },
    [{ type: "function", name: "lookup", parameters: { type: "object" } }],
    (event) => deltas.push(event),
  );
  assert.equal(requestBody.model, "claude-test");
  assert.equal(requestBody.system, "系统指令");
  assert.equal(requestBody.stream, true);
  assert.equal(response.status, "completed");
  assert.deepEqual(
    response.output.map((item) => item.type),
    ["reasoning", "function_call", "message"],
  );
  assert.equal(response.output[0].native.block.signature, "signed");
  assert.equal(response.output[1].arguments, '{"x":1}');
  assert.deepEqual(response.usage, {
    input_tokens: 3,
    cache_read_input_tokens: 10,
    output_tokens: 2,
  });
  assert.equal(response.metering.context_tokens, 15);
  assert.deepEqual(
    deltas.map((event) => event.type),
    ["reasoning", "message"],
  );
});

test("Claude 非流式响应也会转成统一输出", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_plain",
        role: "assistant",
        model: "upstream-claude",
        content: [{ type: "text", text: "OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const response = await callModel("", [user("test")], "claude-test", {
    ...config,
    url: `http://127.0.0.1:${server.address().port}/messages`,
  });
  assert.equal(response.status, "completed");
  assert.equal(response.output[0].content[0].text, "OK");
  assert.deepEqual(response.usage, { input_tokens: 2, output_tokens: 1 });
  assert.equal(response.metering.context_tokens, 3);
});

test("protocol 接受三种当前协议，拒绝未知协议", () => {
  for (const protocol of ["responses", "chat-completions", "anthropic-messages"]) {
    validateConfig(
      configured(
        { model: config.model, url: config.url, key: config.key, protocol },
        { api: { token: "test-access-token-123456", listen: "127.0.0.1:0" } },
      ),
    );
  }
  assert.throws(
    () =>
      validateConfig(
        configured(
          { protocol: "unknown" },
          { api: { token: "test-access-token-123456", listen: "127.0.0.1:0" } },
        ),
      ),
    /协议/,
  );
});

test("Claude 已收到工具参数后断流不重试", async (t) => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      eventBody([
        {
          type: "message_start",
          message: { id: "msg_partial", role: "assistant", model: "upstream-claude", content: [] },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"x":' },
        },
      ]),
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
      [user("go")],
      "claude-test",
      {
        ...config,
        url: `http://127.0.0.1:${server.address().port}/messages`,
      },
      [],
      () => {},
    ),
    { code: "stream_interrupted" },
  );
  assert.equal(requests, 1);
});

test("兼容代理在最后的 content_block_stop 前发送 message_delta", async () => {
  const events = claudeEvents();
  const stop = events.findIndex((event) => event.type === "content_block_stop");
  const delta = events.findIndex((event) => event.type === "message_delta");
  [events[stop], events[delta]] = [events[delta], events[stop]];
  const response = await readClaudeStream(new Response(eventBody(events)).body, {
    source: config.url,
    model: config.model,
    request: buildClaudePayload({ messages: [user("go")], model: config.model, config }),
  });
  assert.equal(response.status, "completed");
  assert.equal(response.output[0].content[0].text, "你好");
});

test("新用户消息的时间和目录变化不改写 Claude 已签名前缀", () => {
  const initial = user("开始");
  appendEnvironment(initial, captureEnvironment("/first-workdir", 1000));
  const request = buildClaudePayload({
    instructions: config.system,
    messages: [initial],
    model: config.model,
    config,
  });
  const response = normalizeClaude(
    {
      id: "msg_environment",
      model: config.model,
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "思考", signature: "environment-signature" },
        { type: "text", text: "回答" },
      ],
    },
    { source: config.url, model: config.model, request },
  );
  const next = user("继续");
  appendEnvironment(next, captureEnvironment("/next-workdir", 2000));
  const messages = [initial, ...response.output, next];
  const before = structuredClone(messages);
  const payload = buildClaudePayload({
    instructions: config.system,
    messages,
    model: config.model,
    config,
  });
  assert.equal(payload.system, request.system);
  assert.deepEqual(payload.messages[0], request.messages[0]);
  assert.equal(payload.messages[1].content[0].signature, "environment-signature");
  assert.ok(payload.messages.at(-1).content.at(-1).text.includes("/next-workdir"));
  assert.ok(payload.messages.at(-1).content.at(-1).text.includes("1970-01-01T00:00:02.000Z"));
  assert.deepEqual(messages, before);
});
