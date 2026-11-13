import { spawnCommand, terminateCommand } from "../../shell-process.js";
export default function shell(args, config, signal, context, callId) {
  signal?.throwIfAborted();
  if (args.background !== undefined && typeof args.background !== "boolean") {
    throw new Error("background 必须是布尔值");
  }
  if (args.background) {
    if (!context) {
      throw new Error("当前运行没有命令执行器");
    }
    return { text: JSON.stringify(context.manager.shell.start(args, context, config, callId)) };
  }
  return new Promise((resolve, reject) => {
    const child = spawnCommand(args, config);
    let text = "";
    let truncated = false;
    let timedOut = false;
    let finished = false;
    let killTimer;
    const append = (data) => {
      const chunk = data.toString();
      const room = Math.max(0, config.max_output - text.length);
      text += chunk.slice(0, room);
      if (chunk.length > room) {
        truncated = true;
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const stop = () => {
      terminateCommand(child);
      if (!killTimer) {
        killTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(-1);
        }, 2000);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, config.timeout * 1000);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", stop);
    };
    const finish = (code) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      resolve({
        failed: timedOut || code !== 0,
        text: `${text || "(无输出)"}${truncated ? "\n…（输出已截断）" : ""}${timedOut ? "\n[超时：命令已终止]" : ""}\n\n[退出码 ${code ?? -1}]`,
      });
    };
    signal?.addEventListener("abort", stop, { once: true });
    child.once("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(error);
    });
    child.once("exit", () => terminateCommand(child));
    child.once("close", finish);
  });
}
