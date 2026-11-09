import { run } from "../agent/index.js";
import { message } from "../ai/index.js";
import { requireModel, renderPrompt, validateConfig } from "../config.js";
import openDB from "../db.js";
import {
  createRunRecorder,
  createSession,
  loadContext,
  messagePreview,
  saveUserMessage,
} from "../session.js";

export default async function ask(prompt, config, { workdir, locations } = {}) {
  if (!prompt.trim()) {
    throw new Error("用法：agent ask [--workdir 目录] <问题>");
  }
  if (workdir !== undefined) {
    config.workdir = workdir;
    validateConfig(config);
  }
  if (!locations) {
    throw new Error("agent ask 需要数据目录");
  }
  requireModel(config);

  const db = openDB(locations.db);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("回复超时", "TimeoutError")),
    config.run_timeout * 1000,
  );
  let receivedText = false;
  try {
    const session = createSession(db);
    const userItem = message(prompt);
    saveUserMessage(db, session.id, userItem);
    const { messages, messageIds, usage } = loadContext(db, session.id);
    const recorder = createRunRecorder(db, session.id, messageIds, messagePreview(userItem));
    const result = await run({
      instructions: renderPrompt(config.system, config.workdir),
      messages,
      model: config.model,
      config,
      usage,
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
    db.close();
  }
}
