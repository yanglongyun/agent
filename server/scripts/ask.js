import { run } from "../agent/index.js";
import { message } from "../ai/index.js";
import { requireModel, renderPrompt, validateConfig } from "../config.js";

export default async function ask(prompt, config, { workdir } = {}) {
  if (!prompt.trim()) {
    throw new Error("用法：agent ask [--workdir 目录] <问题>");
  }
  if (workdir !== undefined) {
    config.workdir = workdir;
    validateConfig(config);
  }
  requireModel(config);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("回复超时", "TimeoutError")),
    config.run_timeout * 1000,
  );
  let receivedText = false;
  try {
    const result = await run({
      instructions: renderPrompt(config.system, config.workdir),
      messages: [message(prompt)],
      model: config.model,
      config,
      signal: controller.signal,
      onEvent: (event) => {
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
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}
