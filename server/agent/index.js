// 接收消息，执行模型、压缩和工具循环，通过 onEvent 输出九种运行事件。
import { callModel, message, outputText } from "../ai/index.js";
import tools from "./tools.js";
import runTool from "./runner.js";
import compact from "./compact.js";
import { contextTokens } from "../metering/index.js";

export async function run({
  instructions,
  messages,
  model,
  compactModel,
  config,
  usage = null,
  metering = null,
  lastResponseAt = null,
  taskContext,
  signal,
  onEvent = () => {},
}) {
  // 直接使用业务层传入的上下文数组；本次工具循环追加消息，不重新查库。
  let tokens = contextTokens(usage, metering?.protocol || config.protocol);
  let text = "";
  let status = "completed";
  let stopReason;
  let stage = "model";
  let failure;
  try {
    while (true) {
      signal?.throwIfAborted();
      if (taskContext) {
        const results = taskContext.manager.completed(taskContext);
        if (results.length > 0) {
          const summaries = results.map((task) => ({
            task_id: task.id,
            status: task.status,
            model: task.model,
            result: task.result,
            error: task.error,
            cost: task.cost,
          }));
          const item = message("子 Agent 任务结果：\n" + JSON.stringify(summaries));
          const meta = { task_results: results.map((task) => task.id) };
          messages.push(item);
          // 交接输入先提交，再请求主模型；不会伪造第二份工具返回或 call_id。
          await onEvent({ type: "message", item, meta });
        }
      }

      const cacheExpired =
        config.compact_on_cache_expiry &&
        lastResponseAt !== null &&
        Date.now() - lastResponseAt >= config.cache_ttl * 1000;
      if ((tokens !== null && tokens >= config.compact_at) || cacheExpired) {
        stage = "compact";
        const compressed = await compact(
          messages,
          compactModel,
          {
            ...config,
            url: config.compact_connection.url,
            key: config.compact_connection.key,
            protocol: config.compact_connection.protocol,
          },
          signal,
          onEvent,
        );
        if (compressed) {
          // 调用方保存摘要成功后，才替换上下文并继续请求。
          await onEvent({ type: "compact", status: "completed", ...compressed });
          messages.splice(compressed.start, compressed.end - compressed.start, compressed.item);
          usage = null;
          tokens = null;
          lastResponseAt = null;
        }
      }

      stage = "model";

      // 业务方已准备好指令，这里直接透传，不拼装、不替换。
      const response = await callModel(
        instructions,
        messages,
        model,
        config,
        tools,
        onEvent,
        signal,
      );
      signal?.throwIfAborted();
      // 先确认整份输出有效，再交付完整块、执行工具。
      for (const item of response.output) {
        if (!["message", "reasoning", "function_call"].includes(item.type)) {
          throw new Error(`不支持的模型输出类型：${item.type}`);
        }
        if (item.type === "function_call" && (typeof item.call_id !== "string" || !item.call_id)) {
          throw new Error("模型工具调用缺少 call_id");
        }
      }
      const calls = [];
      // 模型完整输出原样追加，作为下一次请求的上下文。
      for (const item of response.output) {
        messages.push(item);
        await onEvent({ type: item.type, item });
        if (item.type === "message") {
          text += outputText(item);
        }
        if (item.type === "function_call") {
          calls.push(item);
        }
      }
      lastResponseAt = Date.now();
      usage = response.usage || null;
      metering = response.metering;
      tokens = metering?.context_tokens ?? null;
      await onEvent({ type: "usage", usage, metering });
      signal?.throwIfAborted();
      if (calls.length === 0) {
        if (
          taskContext &&
          (taskContext.manager.pending(taskContext) ||
            taskContext.manager.completed(taskContext).length > 0)
        ) {
          await taskContext.manager.waitForChildren(taskContext, signal);
          continue;
        }
        break;
      }
      stage = "tool";
      for (const call of calls) {
        signal?.throwIfAborted();
        const output = await runTool(call, config, signal, taskContext);
        signal?.throwIfAborted();
        const item = {
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ success: !output.failed, text: output.text }),
        };
        if (output.imageURL) {
          item.output = [
            { type: "input_text", text: item.output },
            { type: "input_image", image_url: output.imageURL, detail: "auto" },
          ];
        }
        // 工具结果也追加到同一数组，下一轮模型请求直接使用。
        messages.push(item);
        const event = { type: "function_call_output", item };
        if (output.taskResults?.length) {
          event.meta = { task_results: output.taskResults };
        }
        await onEvent(event);
      }
    }
  } catch (error) {
    if (signal?.aborted && signal.reason?.name !== "TimeoutError") {
      status = "aborted";
      stopReason = "aborted";
    } else {
      status = "incomplete";
      let code = error.code || `${stage}_error`;
      if (signal?.reason?.name === "TimeoutError" || error.name === "TimeoutError") {
        code = "timeout";
      }
      stopReason = error.stopReason || code;
      failure = { type: "error", code, error: error.message };
    }
  }
  // 终止事件也必须交付，不因 signal 已取消而跳过。
  try {
    if (failure) {
      await onEvent(failure);
    }
  } finally {
    const done = { type: "done", status };
    if (stopReason) {
      done.stopReason = stopReason;
    }
    await onEvent(done);
  }
  return { text, tokens, status, stopReason };
}
