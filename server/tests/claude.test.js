import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { callModel, message } from "../ai/index.js";
import { buildClaudePayload } from "../ai/claude.js";
import { defaults, validateConfig } from "../config.js";

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

test("Claude 历史转换文本、工具、结果和签名原块", () => {
  const signature = "signed-thinking";
  const thinking = {
    type: "reasoning",
    summary: [{ type: "summary_text", text: "思考" }],
    native: {
      protocol: "anthropic-messages",
      source: config.url,
      request_model: config.model,
      block: { type: "thinking", thinking: "思考", signature },
    },
  };
  const input = [user("开始"), thinking, call("a:1"), result("a:1"), user("继续")];
  const before = structuredClone(input);
  const payload = buildClaudePayload({
    instructions: "系统指令",
    messages: input,
    model: config.model,
    config,
    tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
  });
  assert.equal(payload.system, "系统指令");
  assert.equal(payload.max_tokens, 8192);
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
  const thinking = {
    type: "reasoning",
    summary: [],
    native: {
      protocol: "anthropic-messages",
      source: config.url,
      request_model: config.model,
      block: { type: "thinking", thinking: "思考", signature: "signed-thinking" },
    },
  };
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
  assert.equal(response.usage.total_tokens, 15);
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
  assert.equal(response.usage.total_tokens, 3);
});

test("protocol 只接受 Responses 或 Claude Messages", () => {
  validateConfig({ ...config, api: { token: "test-access-token-123456", listen: "127.0.0.1:0" } });
  assert.throws(
    () =>
      validateConfig({
        ...config,
        protocol: "chat-completions",
        api: { token: "test-access-token-123456", listen: "127.0.0.1:0" },
      }),
    /protocol/,
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
