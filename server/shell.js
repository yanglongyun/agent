import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawnCommand, terminateCommand } from "./shell-process.js";

const active = (record) => ["running", "cancelling"].includes(record.status);

// 只管理显式启动的后台命令。stdio 通过随机 ID 访问所属会话的进程，不接受系统 PID。
export function createShellManager(db) {
  const jobs = new Map();
  let closing = false;

  function info(id, scope) {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("process_id 不能为空");
    }
    const record = db.prepare("SELECT * FROM shell_jobs WHERE id = ?").get(id);
    if (!record || record.session_id !== scope.sessionId) {
      throw new Error("后台命令不存在或不属于当前会话");
    }
    if (scope.taskId && record.task_id !== scope.taskId) {
      throw new Error("只能访问当前任务启动的后台命令");
    }
    if (active(record)) {
      try {
        process.kill(record.worker_pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          record.status = "interrupted";
          record.error = "命令执行进程已退出";
          record.completed_at = Date.now();
          record.updated_at = record.completed_at;
          db.prepare(
            "UPDATE shell_jobs SET status = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?",
          ).run(record.status, record.error, record.updated_at, record.completed_at, id);
        }
      }
    }
    return record;
  }

  function start(args, scope, config, callId) {
    if (closing) {
      throw new Error("命令执行器已关闭");
    }
    if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(scope.sessionId)) {
      throw new Error("会话不存在");
    }
    if (
      scope.taskId &&
      !db
        .prepare("SELECT id FROM tasks WHERE id = ? AND session_id = ?")
        .get(scope.taskId, scope.sessionId)
    ) {
      throw new Error("任务不存在");
    }
    if (
      db
        .prepare(
          "SELECT COUNT(*) n FROM shell_jobs WHERE session_id = ? AND status IN ('running', 'cancelling')",
        )
        .get(scope.sessionId).n >= 8
    ) {
      throw new Error("当前会话已有 8 条运行中的后台命令");
    }
    // 校验参数在创建记录和启动进程之前完成。
    if (
      typeof args.command !== "string" ||
      !args.command.trim() ||
      Buffer.byteLength(args.command) > 128 * 1024
    ) {
      throw new Error("command 必须是非空字符串且不能超过 128 KiB");
    }
    if (args.workdir !== undefined && typeof args.workdir !== "string") {
      throw new Error("workdir 必须是字符串");
    }
    const id = randomUUID();
    const now = Date.now();
    const workdir = path.resolve(config.workdir || process.cwd(), args.workdir || ".");
    db.prepare(
      "INSERT INTO shell_jobs (id, session_id, task_id, call_id, command, workdir, status, output, truncated, stdin_closed, worker_pid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'running', '', 0, 0, ?, ?, ?)",
    ).run(
      id,
      scope.sessionId,
      scope.taskId ?? null,
      callId ?? null,
      args.command,
      workdir,
      process.pid,
      now,
      now,
    );
    let child;
    try {
      child = spawnCommand(args, config, true);
    } catch (error) {
      db.prepare(
        "UPDATE shell_jobs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
      ).run(error.message, Date.now(), id);
      throw error;
    }
    let resolveDone;
    const job = {
      child,
      done: new Promise((resolve) => {
        resolveDone = resolve;
      }),
    };
    jobs.set(id, job);
    let output = "";
    let truncated = false;
    let finished = false;
    let errorText = null;
    let killTimer;
    const append = (chunk) => {
      output += chunk;
      if (output.length > config.max_output) {
        output = output.slice(-config.max_output);
        truncated = true;
      }
      db.prepare(
        "UPDATE shell_jobs SET output = ?, truncated = ?, updated_at = ? WHERE id = ?",
      ).run(output, truncated ? 1 : 0, Date.now(), id);
    };
    const finish = (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearInterval(poll);
      clearTimeout(killTimer);
      // 主命令退出时也回收它留下的子进程，防止无人管理的后台进程。
      terminateCommand(child);
      const current = db.prepare("SELECT status FROM shell_jobs WHERE id = ?").get(id);
      let status = code === 0 && !errorText ? "completed" : "failed";
      if (current?.status === "cancelling") {
        status = "cancelled";
      }
      const ended = Date.now();
      db.prepare(
        "UPDATE shell_jobs SET status = ?, exit_code = ?, error = ?, stdin_closed = 1, updated_at = ?, completed_at = ? WHERE id = ?",
      ).run(status, code, errorText, ended, ended, id);
      jobs.delete(id);
      resolveDone();
    };
    const stop = () => {
      terminateCommand(child);
      if (!killTimer) {
        killTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(null);
        }, 2000);
      }
    };
    job.stop = stop;
    const poll = setInterval(() => {
      if (
        db.prepare("SELECT status FROM shell_jobs WHERE id = ?").get(id)?.status === "cancelling"
      ) {
        stop();
      }
    }, 100);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    // 管道关闭由下一次写入返回事实，不让 EPIPE 成为未处理事件。
    child.stdin.on("error", () => {
      if (!finished) {
        db.prepare("UPDATE shell_jobs SET stdin_closed = 1 WHERE id = ?").run(id);
      }
    });
    child.once("error", (error) => {
      errorText = error.message;
      finish(null);
    });
    child.once("exit", () => terminateCommand(child));
    child.once("close", finish);
    return { process_id: id, status: "running" };
  }

  async function wait(id, scope, signal, seconds = 30) {
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 60) {
      throw new Error("等待时间必须为 0 到 60 秒的整数");
    }
    const until = Date.now() + seconds * 1000;
    while (true) {
      signal?.throwIfAborted();
      const record = info(id, scope);
      if (!active(record) || Date.now() >= until) {
        return record;
      }
      await delay(50, undefined, { signal });
    }
  }

  async function cancel(id, scope) {
    const record = info(id, scope);
    if (active(record)) {
      db.prepare("UPDATE shell_jobs SET status = 'cancelling', updated_at = ? WHERE id = ?").run(
        Date.now(),
        id,
      );
      const job = jobs.get(id);
      if (job) {
        job.stop();
        await job.done;
      } else {
        const stopped = await wait(id, scope, undefined, 3);
        if (active(stopped)) {
          throw new Error("命令仍在停止，请稍后重试");
        }
      }
    }
    return info(id, scope);
  }

  async function stdio(args, scope, signal) {
    signal?.throwIfAborted();
    const record = info(args.process_id, scope);
    switch (args.action) {
      case "read":
        return record;
      case "wait":
        return wait(record.id, scope, signal, args.seconds ?? 30);
      case "cancel":
        return cancel(record.id, scope);
      case "write":
      case "close": {
        const job = jobs.get(record.id);
        if (!active(record) || !job || job.child.stdin.destroyed || job.child.stdin.writableEnded) {
          throw new Error("命令输入管道已关闭或不属于当前执行进程");
        }
        if (args.action === "write") {
          if (typeof args.input !== "string" || Buffer.byteLength(args.input) > 128 * 1024) {
            throw new Error("input 必须是字符串且不能超过 128 KiB");
          }
          if (job.child.stdin.writableLength + Buffer.byteLength(args.input) > 128 * 1024) {
            throw new Error("命令尚未读取之前的输入，请稍后重试");
          }
          job.child.stdin.write(args.input);
        } else {
          job.child.stdin.end();
          db.prepare("UPDATE shell_jobs SET stdin_closed = 1, updated_at = ? WHERE id = ?").run(
            Date.now(),
            record.id,
          );
        }
        return info(record.id, scope);
      }
      default:
        throw new Error("action 必须是 read、write、wait、close 或 cancel");
    }
  }

  async function cancelScope(scope) {
    const rows = db
      .prepare(
        "SELECT id FROM shell_jobs WHERE session_id = ? AND (? IS NULL OR task_id = ?) AND status IN ('running', 'cancelling')",
      )
      .all(scope.sessionId, scope.taskId ?? null, scope.taskId ?? null);
    await Promise.all(rows.map((row) => cancel(row.id, scope)));
  }

  async function close() {
    closing = true;
    const current = [...jobs.keys()];
    await Promise.all(
      current.map((id) => {
        const record = db.prepare("SELECT session_id FROM shell_jobs WHERE id = ?").get(id);
        return cancel(id, { sessionId: record.session_id });
      }),
    );
  }

  return { start, info, stdio, wait, cancel, cancelScope, close };
}
