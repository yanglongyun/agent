const fail = (message, code = "invalid_request") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function parts(content) {
  if (!Array.isArray(content)) {
    fail("Chat message content must be an array");
  }
  return content.map((part) => {
    if (["input_text", "output_text"].includes(part.type)) {
      return { type: "text", text: part.text };
    }
    if (part.type === "input_image") {
      if (typeof part.image_url !== "string" || part.image_url.startsWith("/api/images/")) {
        fail("Expand local images before Chat serialization");
      }
      const image = { url: part.image_url };
      if (part.detail) {
        image.detail = part.detail;
      }
      return { type: "image_url", image_url: image };
    }
    if (part.type === "refusal") {
      return { type: "refusal", refusal: part.refusal };
    }
    fail(`Unsupported Chat content type: ${part.type}`);
  });
}

function validateCall(call, code = "invalid_request") {
  if (
    typeof call.id !== "string" ||
    !call.id ||
    call.type !== "function" ||
    typeof call.function?.name !== "string" ||
    !call.function.name ||
    typeof call.function.arguments !== "string"
  ) {
    fail("Invalid Chat tool call", code);
  }
  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    fail("Chat tool arguments must be complete JSON", code);
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    fail("Chat tool arguments must be an object", code);
  }
}

export function buildChatPayload({
  instructions,
  messages,
  model,
  config,
  tools = [],
  stream = false,
}) {
  const output = [];
  const pending = new Set();
  const seen = new Set();
  const images = [];
  let assistant = null;
  const assistantMessage = () => {
    if (!assistant) {
      assistant = { role: "assistant", content: null };
      output.push(assistant);
    }
    return assistant;
  };
  if (instructions) {
    output.push({ role: "system", content: instructions });
  }
  for (const item of messages) {
    const native =
      item.native?.protocol === "chat-completions" &&
      item.native.source === config.url &&
      item.native.request_model === model
        ? item.native.block
        : null;
    if (item.type === "function_call_output") {
      if (!pending.delete(item.call_id)) {
        fail("Orphan or duplicate Chat tool result");
      }
      assistant = null;
      let content = item.output;
      if (Array.isArray(content)) {
        const converted = parts(content);
        content = converted
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const pictures = converted.filter((part) => part.type === "image_url");
        if (pictures.length) {
          images.push({ type: "text", text: `Images from tool ${item.call_id}:` }, ...pictures);
        }
      }
      if (typeof content !== "string") {
        fail("Chat tool output must be text or content parts");
      }
      output.push({ role: "tool", tool_call_id: item.call_id, content });
      // Chat 的 tool 消息只支持文本；图片在全部工具返回后作为视觉输入发送。
      // 仅改变本次请求的序列化，内部工具结果和已保存消息保持原样。
      if (pending.size === 0 && images.length) {
        output.push({ role: "user", content: images.splice(0) });
      }
      continue;
    }
    if (
      pending.size &&
      (!assistant ||
        (item.type !== "function_call" &&
          item.type !== "reasoning" &&
          !(item.type === "message" && item.role === "assistant")))
    ) {
      fail("Unanswered Chat tools must be settled before continuing");
    }
    if (item.type === "function_call") {
      const call = {
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      };
      // Gemini 的工具签名位于厂商扩展内，只回送给产生它的端点和模型。
      if (
        native?.id === call.id &&
        native.function?.name === call.function.name &&
        native.function.arguments === call.function.arguments &&
        native.extra_content != null
      ) {
        call.extra_content = structuredClone(native.extra_content);
      }
      validateCall(call);
      if (seen.has(call.id)) {
        fail("Duplicate Chat tool call");
      }
      const target = assistantMessage();
      target.tool_calls ||= [];
      target.tool_calls.push(call);
      pending.add(call.id);
      seen.add(call.id);
      continue;
    }
    if (item.type === "reasoning") {
      if (typeof native?.reasoning_content === "string") {
        const target = assistantMessage();
        target.reasoning_content = (target.reasoning_content || "") + native.reasoning_content;
      }
      continue;
    }
    if (
      item.type !== "message" ||
      !["user", "assistant", "system", "developer"].includes(item.role)
    ) {
      fail(`Unsupported Chat history item: ${item.type}`);
    }
    const content = parts(item.content);
    if (item.role === "assistant") {
      if (content.some((part) => part.type === "image_url")) {
        fail("Chat assistant messages cannot contain images");
      }
      const target = assistantMessage();
      target.content ||= [];
      target.content.push(...content);
      if (native?.extra_content != null) {
        target.extra_content = structuredClone(native.extra_content);
      }
    } else {
      assistant = null;
      output.push({ role: item.role, content });
    }
  }
  if (pending.size) {
    fail("Unanswered Chat tools must be settled before continuing");
  }
  const payload = { model, messages: output, stream };
  if (tools.length) {
    // 这两个模型仅在 none 模式下支持 Chat Completions 工具调用。
    // https://developers.openai.com/api/docs/guides/latest-model
    if (["gpt-6-luna", "gpt-6-sol"].includes(model)) {
      payload.reasoning_effort = "none";
    }
    payload.tools = tools.map((tool) => {
      if (tool.type !== "function") {
        fail(`Unsupported Chat tool: ${tool.type}`);
      }
      const definition = {
        name: tool.name,
        description: tool.description,
        parameters: structuredClone(tool.parameters),
      };
      if (tool.strict !== undefined) {
        definition.strict = tool.strict;
      }
      return { type: "function", function: definition };
    });
  }
  if (stream) {
    payload.stream_options = { include_usage: true };
  }
  return payload;
}

export function normalizeChat(completion, { source, model }) {
  if (completion.error) {
    fail(completion.error.message || "Chat response error", "response_failed");
  }
  if (
    typeof completion.id !== "string" ||
    !completion.id ||
    !Array.isArray(completion.choices) ||
    completion.choices.length !== 1 ||
    completion.choices[0]?.index !== 0
  ) {
    fail("Invalid Chat completion", "invalid_response");
  }
  const choice = completion.choices[0];
  const reason = choice.finish_reason;
  const base = {
    id: completion.id,
    model: completion.model,
    usage: completion.usage || null,
    service_tier: completion.service_tier,
  };
  if (reason === "length") {
    return { ...base, status: "incomplete", output: [], incomplete_details: { reason: "length" } };
  }
  if (!["stop", "tool_calls"].includes(reason)) {
    fail(`Chat completion stopped: ${reason}`, "response_failed");
  }
  const message = choice.message;
  if (
    message?.role !== "assistant" ||
    (message.content != null && typeof message.content !== "string")
  ) {
    fail("Invalid Chat assistant message", "invalid_response");
  }
  const output = [];
  const append = (item, block) =>
    output.push({
      ...item,
      id: `${completion.id}_${output.length}`,
      native: {
        protocol: "chat-completions",
        source,
        request_model: model,
        model: completion.model,
        message_id: completion.id,
        block: structuredClone(block),
      },
    });
  if (message.reasoning_content) {
    if (typeof message.reasoning_content !== "string") {
      fail("Invalid Chat reasoning content", "invalid_response");
    }
    append(
      { type: "reasoning", summary: [{ type: "summary_text", text: message.reasoning_content }] },
      { reasoning_content: message.reasoning_content },
    );
  }
  if (message.content || message.refusal) {
    const content = [];
    if (message.content) {
      content.push({ type: "output_text", text: message.content });
    }
    if (message.refusal) {
      if (typeof message.refusal !== "string") {
        fail("Invalid Chat refusal", "invalid_response");
      }
      content.push({ type: "refusal", refusal: message.refusal });
    }
    append(
      { type: "message", role: "assistant", status: "completed", content },
      {
        content: message.content,
        refusal: message.refusal,
        ...(message.extra_content != null ? { extra_content: message.extra_content } : {}),
      },
    );
  }
  const calls = message.tool_calls || [];
  // Gemini 的 OpenAI 接口可在完整工具调用后以 stop 结束。
  if (
    !Array.isArray(calls) ||
    (reason === "tool_calls" && !calls.length) ||
    (reason === "stop" && calls.length && !model.startsWith("gemini-"))
  ) {
    fail("Chat tool calls do not match finish_reason", "invalid_response");
  }
  const ids = new Set();
  for (const call of calls) {
    validateCall(call, "invalid_response");
    if (ids.has(call.id)) {
      fail("Duplicate Chat response tool call", "invalid_response");
    }
    ids.add(call.id);
    append(
      {
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        status: "completed",
      },
      call,
    );
  }
  if (!output.length) {
    append(
      { type: "message", role: "assistant", status: "completed", content: [] },
      {
        content: message.content,
        ...(message.extra_content != null ? { extra_content: message.extra_content } : {}),
      },
    );
  }
  return { ...base, status: "completed", output };
}

export async function readChatStream(body, { source, model, signal, onEvent, onActivity }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map();
  const completion = {
    choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: null }],
  };
  const choice = completion.choices[0];
  let buffer = "";
  let size = 0;
  let done = false;
  const dispatch = async (raw) => {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) {
      return;
    }
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      fail("Invalid JSON in Chat stream", "invalid_response");
    }
    if (chunk.error) {
      fail(chunk.error.message || "Chat stream error", "response_failed");
    }
    if (
      typeof chunk.id !== "string" ||
      !chunk.id ||
      (completion.id && completion.id !== chunk.id) ||
      !Array.isArray(chunk.choices) ||
      chunk.choices.length > 1
    ) {
      fail("Invalid Chat stream chunk", "invalid_response");
    }
    completion.id = chunk.id;
    completion.model = chunk.model;
    if (chunk.service_tier !== undefined) {
      completion.service_tier = chunk.service_tier;
    }
    if (chunk.usage) {
      completion.usage = chunk.usage;
    }
    onActivity?.();
    if (!chunk.choices.length) {
      return;
    }
    const part = chunk.choices[0];
    if (part.index !== 0 || choice.finish_reason) {
      fail("Invalid Chat choice sequence", "invalid_response");
    }
    const delta = part.delta;
    if (!delta || (delta.role && delta.role !== "assistant") || delta.function_call) {
      fail("Unsupported Chat delta", "invalid_response");
    }
    for (const [field, type] of [
      ["content", "message"],
      ["reasoning_content", "reasoning"],
      ["refusal", "message"],
    ]) {
      if (delta[field] != null) {
        if (typeof delta[field] !== "string") {
          fail(`Invalid Chat ${field} delta`, "invalid_response");
        }
        choice.message[field] = (choice.message[field] || "") + delta[field];
        if (delta[field]) {
          await onEvent?.({ type, delta: delta[field] });
        }
      }
    }
    if (delta.extra_content != null) {
      choice.message.extra_content = structuredClone(delta.extra_content);
    }
    if (delta.tool_calls != null && !Array.isArray(delta.tool_calls)) {
      fail("Invalid Chat tool deltas", "invalid_response");
    }
    for (const part of delta.tool_calls || []) {
      if (!part || typeof part !== "object" || (part.type != null && part.type !== "function")) {
        fail("Invalid Chat tool delta", "invalid_response");
      }
      let key = part.index;
      if (
        part.index === undefined &&
        model.startsWith("gemini-") &&
        typeof part.id === "string" &&
        part.id
      ) {
        // Gemini 完整工具块可能没有 index；只按返回的原始调用 ID 关联，不猜测数组位置。
        key = part.id;
      } else if (!Number.isSafeInteger(part.index) || part.index < 0) {
        fail("Invalid Chat tool delta", "invalid_response");
      }
      const call = calls.get(key) || {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (part.id != null) {
        if (typeof part.id !== "string" || (call.id && call.id !== part.id)) {
          fail("Conflicting Chat tool IDs", "invalid_response");
        }
        call.id = part.id;
      }
      for (const field of ["name", "arguments"]) {
        if (part.function?.[field] != null) {
          if (typeof part.function[field] !== "string") {
            fail("Invalid Chat tool function delta", "invalid_response");
          }
          call.function[field] += part.function[field];
        }
      }
      if (part.extra_content != null) {
        call.extra_content = structuredClone(part.extra_content);
      }
      calls.set(key, call);
    }
    if (part.finish_reason != null) {
      choice.finish_reason = part.finish_reason;
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!done) {
      signal?.throwIfAborted();
      let chunk;
      try {
        chunk = await reader.read();
      } catch (cause) {
        fail(`Chat stream interrupted: ${cause.message}`, "stream_interrupted");
      }
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (chunk.done && buffer.trim()) {
        buffer += "\n\n";
      }
      size += chunk.value?.length || 0;
      if (size > 64 * 1024 * 1024) {
        fail("Chat stream exceeds size limit", "invalid_response");
      }
      let index = buffer.indexOf("\n\n");
      while (index >= 0 && !done) {
        await dispatch(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
      if (chunk.done) {
        break;
      }
    }
    signal?.throwIfAborted();
    if (!done || !choice.finish_reason) {
      fail("Chat stream ended before completion", "stream_interrupted");
    }
    choice.message.tool_calls = [...calls.entries()]
      .sort(([a], [b]) => {
        if (typeof a === "number" && typeof b === "number") {
          return a - b;
        }
        return 0;
      })
      .map(([, call]) => call);
    return normalizeChat(completion, { source, model });
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
