import { createHash } from "node:crypto";

const fail = (message, code = "invalid_request") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const callId = (id) =>
  /^[A-Za-z0-9_-]{1,64}$/.test(String(id))
    ? String(id)
    : `call_${createHash("sha256").update(String(id)).digest("hex").slice(0, 40)}`;

function normalizeUsage(source = {}) {
  const input =
    (source.input_tokens || 0) +
    (source.cache_creation_input_tokens || 0) +
    (source.cache_read_input_tokens || 0);
  return {
    ...source,
    uncached_input_tokens: source.input_tokens || 0,
    input_tokens: input,
    output_tokens: source.output_tokens || 0,
    total_tokens: input + (source.output_tokens || 0),
  };
}

function normalizeToolOutput(value) {
  if (
    Array.isArray(value) &&
    value.length &&
    value.every((part) => {
      if (!part || typeof part !== "object") {
        return false;
      }
      if (part.type === "input_text") {
        return typeof part.text === "string";
      }
      if (part.type === "input_image") {
        return typeof part.image_url === "string";
      }
      return false;
    })
  ) {
    return value;
  }
  if (value == null) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parts(content) {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    fail("Unsupported message content");
  }
  return content.map((part) => {
    if (["input_text", "output_text", "text"].includes(part.type)) {
      return { type: "text", text: String(part.text ?? "") };
    }
    if (part.type === "input_image") {
      const url = String(part.image_url || "");
      const data = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
      if (data) {
        return { type: "image", source: { type: "base64", media_type: data[1], data: data[2] } };
      }
      if (/^https:\/\//.test(url)) {
        return { type: "image", source: { type: "url", url } };
      }
      fail("Expand local image references before serialization");
    }
    fail(`Unsupported content type: ${part.type}`);
  });
}

function toolResult(output) {
  const content = parts(normalizeToolOutput(output));
  if (typeof output !== "string") {
    return { content, is_error: false };
  }
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === "object" && typeof parsed.success === "boolean") {
      return { content, is_error: !parsed.success };
    }
  } catch {
    // 工具输出原本就是普通文本。
  }
  return { content, is_error: false };
}

export function buildClaudePayload({
  instructions,
  messages,
  model,
  config,
  tools = [],
  stream = true,
}) {
  const source = config.url;
  const output = [];
  const pending = new Set();
  const seen = new Set();
  let returning = null;
  const append = (role, blocks) => {
    const last = output.at(-1);
    if (last?.role === role) {
      last.content.push(...blocks);
    } else {
      output.push({ role, content: blocks });
    }
  };

  for (const item of messages) {
    if (item.type === "function_call_output") {
      const id = callId(item.call_id);
      if (!pending.has(id)) {
        fail("Orphan or duplicate tool result");
      }
      if (!returning) {
        returning = { role: "user", content: [] };
        output.push(returning);
      }
      const result = toolResult(item.output);
      returning.content.push({
        type: "tool_result",
        tool_use_id: id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      });
      pending.delete(id);
      continue;
    }
    if (item.type === "function_call") {
      if (returning && pending.size) {
        fail("Cannot insert assistant output before all tool results");
      }
      returning = null;
      if (!item.call_id) {
        fail("Missing tool call ID");
      }
      const id = callId(item.call_id);
      if (seen.has(id)) {
        fail("Duplicate tool call");
      }
      let args;
      try {
        args = JSON.parse(item.arguments);
      } catch {
        fail("Tool arguments must be complete JSON");
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        fail("Tool input must be an object");
      }
      append("assistant", [{ type: "tool_use", id, name: item.name, input: args }]);
      pending.add(id);
      seen.add(id);
      continue;
    }
    if (
      pending.size &&
      (returning ||
        !(item.type === "reasoning" || (item.type === "message" && item.role === "assistant")))
    ) {
      fail("Unanswered tools must be settled before switching/continuing");
    }
    returning = null;
    if (item.type === "reasoning") {
      // Claude 的签名原块只回送同一个 Claude 端点和模型；不能用其他协议的思考文本伪造。
      if (
        item.native?.protocol === "anthropic-messages" &&
        item.native.source === source &&
        item.native.request_model === model
      ) {
        const block = item.native.block;
        if (!["thinking", "redacted_thinking"].includes(block?.type)) {
          fail("Invalid Claude reasoning block");
        }
        append("assistant", [structuredClone(block)]);
      }
      continue;
    }
    if (item.type !== "message" || !["user", "assistant"].includes(item.role)) {
      fail(`Unsupported history item: ${item.type}`);
    }
    append(item.role, parts(item.content));
  }
  if (pending.size) {
    fail("Unanswered tools must be settled before switching/continuing");
  }

  const payload = {
    model,
    max_tokens: 64000,
    stream,
    messages: output,
    cache_control: { type: "ephemeral" },
  };
  if (instructions) {
    payload.system = String(instructions);
  }
  if (tools.length) {
    payload.tools = tools.map((tool) => {
      if (tool.type !== "function") {
        fail(`Unsupported tool: ${tool.type}`);
      }
      return {
        name: tool.name,
        description: tool.description || "",
        input_schema: structuredClone(tool.parameters || { type: "object", properties: {} }),
      };
    });
  }
  return payload;
}

export function normalizeClaude(message, { source, model } = {}) {
  const output = (message.content || []).map((block, index) => {
    const native = {
      protocol: "anthropic-messages",
      source,
      request_model: model,
      model: message.model,
      message_id: message.id,
      index,
      block: structuredClone(block),
    };
    if (block.type === "text") {
      return {
        type: "message",
        id: `${message.id}_${index}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: block.text }],
        native,
      };
    }
    if (block.type === "tool_use") {
      return {
        type: "function_call",
        id: `fc_${message.id}_${index}`,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
        status: "completed",
        native,
      };
    }
    if (["thinking", "redacted_thinking"].includes(block.type)) {
      return {
        type: "reasoning",
        id: `rs_${message.id}_${index}`,
        summary:
          block.type === "thinking" && block.thinking
            ? [{ type: "summary_text", text: block.thinking }]
            : [],
        native,
      };
    }
    fail(`Unsupported Claude output block: ${block.type}`, "response_failed");
  });
  const usage = normalizeUsage(message.usage);
  const reason = message.stop_reason;
  if (
    ![
      "end_turn",
      "stop_sequence",
      "tool_use",
      "max_tokens",
      "model_context_window_exceeded",
      "refusal",
    ].includes(reason)
  ) {
    fail(`Unsupported stop reason: ${reason}`, "response_failed");
  }
  if (reason === "refusal") {
    fail("Claude refused the request", "response_failed");
  }
  const incomplete = ["max_tokens", "model_context_window_exceeded"].includes(reason);
  return {
    id: message.id,
    model: message.model,
    status: incomplete ? "incomplete" : "completed",
    output,
    usage,
    ...(incomplete ? { incomplete_details: { reason } } : {}),
  };
}

function sseParser(onEvent) {
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  const dispatch = () => {
    if (!dataLines.length) {
      return;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    if (!data) {
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      fail("Invalid JSON in Claude stream", "response_failed");
    }
    if (event && typeof event === "object") {
      onEvent(String(event.type || ""), event);
    }
  };
  const consume = (text) => {
    buffer += text;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      if (!line) {
        dispatch();
        continue;
      }
      if (line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
  };
  return {
    push(chunk) {
      consume(decoder.decode(chunk, { stream: true }));
    },
    flush() {
      consume(decoder.decode());
      if (buffer) {
        consume("\n");
      }
      dispatch();
    },
  };
}

export async function readClaudeStream(body, { signal, onEvent, onActivity, source, model } = {}) {
  let message;
  let stopped = false;
  let ended = false;
  const blocks = new Map();
  const json = new Map();
  const open = new Set();
  const closedEarly = new Set();
  const parser = sseParser((type, event) => {
    if (type === "ping") {
      return;
    }
    if (stopped) {
      fail("Data after Claude message_stop", "response_failed");
    }
    if (type === "error") {
      fail(
        String(event.error?.message || event.error?.type || "Claude stream error").slice(0, 2000),
        "response_failed",
      );
    }
    if (type === "message_start") {
      if (message || !event.message?.id || event.message.role !== "assistant") {
        fail("Invalid Claude message_start", "response_failed");
      }
      message = structuredClone(event.message);
      onActivity?.();
      return;
    }
    if (!message) {
      fail("Claude event before message_start", "response_failed");
    }
    if (type === "content_block_start") {
      if (ended || !Number.isInteger(event.index) || event.index !== blocks.size || open.size) {
        fail("Invalid Claude block order", "response_failed");
      }
      const block = structuredClone(event.content_block);
      if (!["text", "tool_use", "thinking", "redacted_thinking"].includes(block?.type)) {
        fail("Unsupported Claude content block", "response_failed");
      }
      blocks.set(event.index, block);
      open.add(event.index);
      onActivity?.();
      if (block.type === "text" && block.text) {
        onEvent?.({ type: "message", delta: block.text });
      }
      if (block.type === "thinking" && block.thinking) {
        onEvent?.({ type: "reasoning", delta: block.thinking });
      }
      return;
    }
    if (type === "content_block_delta") {
      if (!open.has(event.index)) {
        fail("Delta outside open Claude block", "response_failed");
      }
      const block = blocks.get(event.index);
      const delta = event.delta;
      onActivity?.();
      if (delta?.type === "text_delta" && block.type === "text" && typeof delta.text === "string") {
        block.text = (block.text || "") + delta.text;
        onEvent?.({ type: "message", delta: delta.text });
      } else if (
        delta?.type === "thinking_delta" &&
        block.type === "thinking" &&
        typeof delta.thinking === "string"
      ) {
        block.thinking = (block.thinking || "") + delta.thinking;
        onEvent?.({ type: "reasoning", delta: delta.thinking });
      } else if (
        delta?.type === "signature_delta" &&
        block.type === "thinking" &&
        typeof delta.signature === "string"
      ) {
        block.signature = (block.signature || "") + delta.signature;
      } else if (
        delta?.type === "input_json_delta" &&
        block.type === "tool_use" &&
        typeof delta.partial_json === "string"
      ) {
        json.set(event.index, (json.get(event.index) || "") + delta.partial_json);
      } else {
        fail("Unsupported Claude content delta", "response_failed");
      }
      return;
    }
    if (type === "content_block_stop") {
      if (!open.delete(event.index) && !closedEarly.delete(event.index)) {
        fail("Claude block stopped without start", "response_failed");
      }
      return;
    }
    if (type === "message_delta") {
      // 一些 Claude 兼容代理会在最后的 content_block_stop 之前发 message_delta；
      // 块内容已经收齐，这里视为代理提前关闭，后续 stop 事件仍接受。
      for (const index of open) {
        closedEarly.add(index);
      }
      open.clear();
      Object.assign(message, event.delta);
      message.usage = { ...message.usage, ...event.usage };
      ended = true;
      return;
    }
    if (type === "message_stop") {
      if (open.size || !ended) {
        fail("Premature Claude message_stop", "response_failed");
      }
      stopped = true;
    }
  });

  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!stopped) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parser.push(value);
    }
    parser.flush();
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (!stopped || !message || open.size) {
      fail("Claude stream ended before message_stop", "stream_interrupted");
    }
    const incomplete = ["max_tokens", "model_context_window_exceeded"].includes(
      message.stop_reason,
    );
    const ids = new Set();
    for (const [index, block] of blocks) {
      if (block.type !== "tool_use") {
        continue;
      }
      if (json.get(index)?.trim()) {
        try {
          block.input = JSON.parse(json.get(index));
        } catch {
          if (!incomplete) {
            fail("Malformed Claude tool arguments", "response_failed");
          }
          block.input = {};
        }
      }
      if (
        !incomplete &&
        (!block.id ||
          !block.name ||
          ids.has(block.id) ||
          !block.input ||
          typeof block.input !== "object" ||
          Array.isArray(block.input))
      ) {
        fail("Invalid or duplicate Claude tool call", "response_failed");
      }
      ids.add(block.id);
    }
    if (!incomplete && (message.stop_reason === "tool_use") !== Boolean(ids.size)) {
      fail("Claude tool calls do not match stop_reason", "response_failed");
    }
    message.content = [...blocks.values()];
    return normalizeClaude(message, { source, model });
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
