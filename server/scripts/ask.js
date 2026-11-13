import { run } from "../agent/index.js";
import { message } from "../ai/index.js";
import { runConfig, validateConfig } from "../config.js";
import openDB from "../db.js";
import { createTaskManager } from "../tasks.js";
import {
  createRunRecorder,
  createSession,
  loadContext,
  messagePreview,
  saveUserMessage,
} from "../session.js";

export default async function ask(
  prompt,
  config,
  { workdir, locations, modelId, compactModelId } = {},
) {
  if (!prompt.trim()) {
    throw new Error(
      "用法：agent ask --model 模型标识 --compact-model 模型标识 [--workdir 目录] <问题>",
    );
  }
  if (workdir !== undefined) {
    config.workdir = workdir;
    validateConfig(config);
  }
  if (!locations) {
    throw new Error("agent ask 需要数据目录");
  }
  config = runConfig(config, modelId, compactModelId);

  const db = openDB(locations.db);
  const tasks = createTaskManager(db, locations);
  const controller = new AbortController();
  const stop = () => controller.abort(new DOMException("已停止", "AbortError"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const timer = setTimeout(
    () => controller.abort(new DOMException("回复超时", "TimeoutError")),
    config.run_timeout * 1000,
  );
  let receivedText = false;
  try {
    const session = createSession(db);
    const userItem = message(prompt);
    const createdAt = Date.now();
    saveUserMessage(
      db,
      { sessionId: session.id },
      userItem,
      config.workdir,
      createdAt,
      [],
      config.model_id,
      config.compact_connection.id,
    );
    const { messages, messageIds, usage, metering, lastResponseAt } = loadContext(db, {
      sessionId: session.id,
    });
    const recorder = createRunRecorder(
      db,
      { sessionId: session.id },
      messageIds,
      messagePreview(userItem),
    );
    const result = await run({
      instructions: config.system,
      messages,
      model: config.model,
      compactModel: config.compact_connection.model,
      config,
      usage,
      metering,
      lastResponseAt,
      taskContext: {
        manager: tasks,
        sessionId: session.id,
        modelId: config.model_id,
        compactModelId: config.compact_connection.id,
      },
      signal: controller.signal,
      onEvent: (event) => {
        recorder.track(event);
        if (event.type === "message" && event.delta) {
          receivedText = true;
          process.stdout.write(event.delta);
          return;
        }
        if (event.type === "function_call") {
          process.stderr.write(`\n[工具] ${event.item.name}\n`);
          return;
        }
        if (event.type === "retry") {
          process.stderr.write(`\n[重试 ${event.attempt}/${event.maxRetries}] ${event.error}\n`);
          return;
        }
        if (event.type === "error") {
          process.stderr.write(`\n[错误] ${event.error}\n`);
        }
      },
    });
    if (receivedText) {
      process.stdout.write("\n");
    } else if (result.text) {
      process.stdout.write(`${result.text}\n`);
    }
    return { ...result, session_id: session.id };
  } finally {
    clearTimeout(timer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await tasks.close();
    db.close();
  }
}
