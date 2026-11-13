import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// 前台与后台命令共用启动方式及进程组清理。
export function spawnCommand(args, config, interactive = false) {
  if (typeof args.command !== "string" || !args.command.trim()) {
    throw new Error("缺少 command 参数");
  }
  if (args.workdir !== undefined && typeof args.workdir !== "string") {
    throw new Error("workdir 必须是字符串");
  }
  const windows = process.platform === "win32";
  let command = "/bin/sh";
  if (windows) {
    command = "powershell.exe";
  } else if (existsSync("/bin/bash")) {
    command = "/bin/bash";
  }
  return spawn(
    command,
    windows ? ["-NoProfile", "-NonInteractive", "-Command", args.command] : ["-c", args.command],
    {
      cwd: path.resolve(config.workdir || process.cwd(), args.workdir || "."),
      detached: !windows,
      windowsHide: true,
      stdio: [interactive ? "pipe" : "ignore", "pipe", "pipe"],
    },
  );
}

export function terminateCommand(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => child.kill());
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") {
        child.kill("SIGKILL");
      }
    }
  }
}
