import { createShellManager } from "./shell.js";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { run } from "./agent/index.js";
import { message } from "./ai/index.js";
import { createRunRecorder, forkContext, loadContext, saveUserMessage } from "./session.js";
import { runConfig } from "./config.js";
import { withCost } from "./metering/index.js";

const terminal = new Set(["completed", "failed", "cancelled", "interrupted"]);

// Web 和 CLI 各自持有执行器；任务状态与完整消息共享数据库。
export function createTaskManager(db, locations) {
  const jobs = new Map();
  const shell = createShellManager(db);
  let closing = false;

  function read(id, scope) {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("task_id 不能为空");
    }
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!task || task.session_id !== scope.sessionId) {
      throw new Error("任务不存在或不属于当前会话");
    }
    if (scope.taskId && task.id !== scope.taskId) {
      let parent = task.parent_task_id;
      while (parent && parent !== scope.taskId) {
        parent = db
          .prepare("SELECT parent_task_id FROM tasks WHERE id = ?")
          .get(parent)?.parent_task_id;
      }
      if (parent !== scope.taskId) {
        throw new Error("只能访问当前任务及其子任务");
      }
    }
    if (!terminal.has(task.status)) {
      try {
        process.kill(task.worker_pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          const now = Date.now();
          db.prepare(
            "UPDATE tasks SET status = 'interrupted', error = ?, updated_at = ?, completed_at = ? WHERE id = ?",
          ).run("任务执行进程已退出", now, now, id);
          task.status = "interrupted";
          task.error = "任务执行进程已退出";
          task.completed_at = now;
        }
      }
    }
    return task;
  }

  function info(id, scope) {
    return withCost(read(id, scope));
  }

  async function execute(task, config, controller) {
    const timer = setTimeout(
      () => controller.abort(new DOMException("任务超时", "TimeoutError")),
      config.run_timeout * 1000,
    );
    const cancellation = setInterval(() => {
      const current = db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id);
      if (current?.status === "cancelling") {
        controller.abort(new DOMException("任务已停止", "AbortError"));
      }
    }, 250);
    const owner = { taskId: task.id };
    const taskConfig = { ...config, images_dir: locations.images, run_images: new Set() };
    let errorText = null;
    let status = "failed";
    let resultText = "";
    try {
      const context = loadContext(db, owner);
      const recorder = createRunRecorder(db, owner, context.messageIds, "");
      const result = await run({
        instructions: config.system,
        messages: context.messages,
        model: task.model,
        compactModel: config.compact_connection.model,
        config: taskConfig,
        usage: context.usage,
        metering: context.metering,
        lastResponseAt: context.lastResponseAt,
        taskContext: {
          manager: api,
          sessionId: task.session_id,
          taskId: task.id,
          modelId: config.model_id,
          compactModelId: config.compact_connection.id,
        },
        signal: controller.signal,
        onEvent(event) {
          const saved = recorder.track(event);
          if (event.type === "error") {
            errorText = event.error;
          }
          for (const item of saved.savedItems || []) {
            if (item.type === "function_call_output" && Array.isArray(item.output)) {
              for (const part of item.output) {
                if (part.type === "input_image") {
                  taskConfig.run_images.delete(part.image_url);
                }
              }
            }
          }
        },
      });
      resultText = result.text;
      if (result.status === "completed") {
        status = "completed";
      } else if (result.status === "aborted") {
        status = "cancelled";
      }
    } catch (error) {
      status = controller.signal.aborted ? "cancelled" : "failed";
      errorText = error.message;
    } finally {
      clearTimeout(timer);
      clearInterval(cancellation);
      for (const url of taskConfig.run_images) {
        await fs
          .rm(path.join(locations.images, path.basename(url)), { force: true })
          .catch(() => {});
      }
      // 父任务失败或停止时，不能留下继续运行的后代任务。
      await cancelChildren({ sessionId: task.session_id, taskId: task.id });
      await shell.cancelScope({ sessionId: task.session_id, taskId: task.id });
      if (controller.signal.aborted && controller.signal.reason?.name !== "TimeoutError") {
        status = "cancelled";
      }
      // 完整清理后才公布终态，读取方此时可以安全地交接或删除任务。
      const now = Date.now();
      db.prepare(
        "UPDATE tasks SET status = ?, result = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?",
      ).run(status, resultText, errorText, now, now, task.id);
      jobs.delete(task.id);
    }
  }

  function start(args, scope, config, callId) {
    if (closing) {
      throw new Error("任务执行器已关闭");
    }
    if (
      typeof args.task !== "string" ||
      !args.task.trim() ||
      Buffer.byteLength(args.task) > 128 * 1024
    ) {
      throw new Error("task 必须填写任务内容且不超过 128 KiB");
    }
    if (args.context !== undefined && !["fork", "none"].includes(args.context)) {
      throw new Error("context 必须是 fork 或 none");
    }
    const selected = runConfig(
      config,
      args.model_id === undefined ? scope.modelId : args.model_id,
      args.compact_model_id === undefined ? scope.compactModelId : args.compact_model_id,
    );
    const active = db
      .prepare(
        "SELECT COUNT(*) n FROM tasks WHERE session_id = ? AND status IN ('running', 'cancelling')",
      )
      .get(scope.sessionId).n;
    if (active >= 8) {
      throw new Error("当前会话已有 8 个运行中的子任务");
    }
    let depth = 1;
    let parent = scope.taskId;
    while (parent) {
      const ancestor = read(parent, { sessionId: scope.sessionId });
      parent = ancestor.parent_task_id;
      depth++;
    }
    if (depth > 3) {
      throw new Error("子任务最多嵌套 3 层");
    }
    const now = Date.now();
    const task = {
      id: randomUUID(),
      session_id: scope.sessionId,
      parent_task_id: scope.taskId ?? null,
      call_id: callId,
      task: args.task.trim(),
      model: selected.model,
      protocol: selected.protocol,
      status: "running",
      result: null,
      error: null,
      worker_pid: process.pid,
      created_at: now,
      updated_at: now,
      completed_at: null,
      delivered_at: null,
    };
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO tasks (id, session_id, parent_task_id, call_id, task, model, protocol, status, worker_pid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        task.id,
        task.session_id,
        task.parent_task_id,
        task.call_id,
        task.task,
        task.model,
        task.protocol,
        task.status,
        process.pid,
        now,
        now,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const owner = { taskId: task.id };
    try {
      if (args.context === "fork") {
        const from = scope.taskId ? { taskId: scope.taskId } : { sessionId: scope.sessionId };
        forkContext(db, from, owner);
      }
      saveUserMessage(
        db,
        owner,
        message(task.task + "\n\n请独立完成任务，结束时简要报告结果、依据和未完成事项。"),
        config.workdir,
        now,
        [],
        selected.model_id,
        selected.compact_connection.id,
      );
    } catch (error) {
      db.prepare(
        "UPDATE tasks SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
      ).run(error.message, Date.now(), task.id);
      throw error;
    }
    const controller = new AbortController();
    const job = { controller, done: null };
    jobs.set(task.id, job);
    // 先把 task_id 返回父工具，执行循环在独立的异步任务中推进。
    job.done = Promise.resolve().then(() => execute(task, selected, controller));
    return {
      task_id: task.id,
      status: task.status,
      model: task.model,
      model_id: selected.model_id,
    };
  }

  async function wait(id, scope, signal, seconds = 30) {
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 60) {
      throw new Error("等待时间必须为 0 到 60 秒的整数");
    }
    const until = Date.now() + seconds * 1000;
    while (true) {
      signal?.throwIfAborted();
      const task = info(id, scope);
      if (terminal.has(task.status) || Date.now() >= until) {
        return task;
      }
      await delay(100, undefined, { signal });
    }
  }

  async function cancel(id, scope) {
    const task = read(id, scope);
    if (!terminal.has(task.status)) {
      db.prepare("UPDATE tasks SET status = 'cancelling', updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      );
      jobs.get(id)?.controller.abort(new DOMException("任务已停止", "AbortError"));
      await cancelChildren({ sessionId: task.session_id, taskId: task.id });
      await jobs.get(id)?.done;
    }
    return info(id, scope);
  }

  async function cancelChildren(scope) {
    const rows = db
      .prepare(
        "SELECT id FROM tasks WHERE session_id = ? AND parent_task_id IS ? AND status IN ('running', 'cancelling')",
      )
      .all(scope.sessionId, scope.taskId ?? null);
    await Promise.all(rows.map((row) => cancel(row.id, scope)));
  }

  function completed(scope) {
    const rows = db
      .prepare(
        "SELECT id FROM tasks WHERE session_id = ? AND parent_task_id IS ? AND delivered_at IS NULL AND status IN ('completed', 'failed', 'cancelled', 'interrupted') ORDER BY created_at, id",
      )
      .all(scope.sessionId, scope.taskId ?? null);
    return rows.map((row) => info(row.id, scope));
  }

  function pending(scope) {
    return (
      db
        .prepare(
          "SELECT COUNT(*) n FROM tasks WHERE session_id = ? AND parent_task_id IS ? AND status IN ('running', 'cancelling')",
        )
        .get(scope.sessionId, scope.taskId ?? null).n > 0
    );
  }

  async function waitForChildren(scope, signal) {
    while (pending(scope) && completed(scope).length === 0) {
      signal?.throwIfAborted();
      // 读取状态时也确认执行进程是否仍存在。
      const rows = db
        .prepare(
          "SELECT id FROM tasks WHERE session_id = ? AND parent_task_id IS ? AND status IN ('running', 'cancelling')",
        )
        .all(scope.sessionId, scope.taskId ?? null);
      for (const row of rows) {
        read(row.id, scope);
      }
      await delay(100, undefined, { signal });
    }
  }

  async function close() {
    closing = true;
    const current = [...jobs.values()];
    for (const job of current) {
      job.controller.abort();
    }
    await Promise.all(current.map((job) => job.done));
    await shell.close();
  }

  const api = {
    shell,
    start,
    info,
    wait,
    cancel,
    cancelChildren,
    completed,
    pending,
    waitForChildren,
    close,
  };
  return api;
}
