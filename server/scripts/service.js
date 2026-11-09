import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, saveConfig } from "../config.js";

// systemd quoting is different from shell quoting; escape specifiers as well.
const quote = (value) =>
  '"' +
  value
    .replace(/%/g, "%%")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r") +
  '"';
export function unitText({ node, cli, data, workdir, system }) {
  return `[Unit]
Description=agentic web agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${quote(node)} ${quote(cli)} serve
Restart=always
RestartSec=2
WorkingDirectory=${quote(workdir)}
Environment=${quote("AGENT_HOME=" + data)}
KillMode=control-group
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=${system ? "multi-user.target" : "default.target"}
`;
}
function target() {
  if (process.platform !== "linux") {
    throw new Error("系统服务管理仅支持 Linux systemd；请运行 agent serve");
  }
  const system = process.getuid() === 0;
  const file = system
    ? "/etc/systemd/system/agentic.service"
    : path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        "systemd/user/agentic.service",
      );
  return { system, file };
}
function systemctl(unit, args, capture = false) {
  const result = spawnSync("systemctl", [...(unit.system ? [] : ["--user"]), ...args], {
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error("未找到可用的 systemctl；请直接运行 agent serve");
  }
  if (result.status && !capture) {
    throw new Error(`systemctl ${args.join(" ")} 失败`);
  }
  return result.stdout?.trim();
}
export function service(command, locations, config, listen) {
  const unit = target();
  if (command === "install") {
    if (listen) {
      config.api.listen = listen;
      saveConfig(locations, config);
    }
    const content = unitText({
      node: process.execPath,
      cli: path.join(ROOT, "server/scripts/cli.js"),
      data: locations.root,
      workdir: config.workdir || os.homedir(),
      system: unit.system,
    });
    fs.mkdirSync(path.dirname(unit.file), { recursive: true });
    fs.writeFileSync(unit.file, content);
    systemctl(unit, ["daemon-reload"]);
    systemctl(unit, ["enable", "agentic"]);
    systemctl(unit, ["restart", "agentic"]);
    if (!unit.system) {
      const result = spawnSync("loginctl", ["enable-linger", os.userInfo().username], {
        stdio: "ignore",
      });
      if (result.status !== 0) {
        console.error(
          `未能启用 linger，管理员可执行：loginctl enable-linger ${os.userInfo().username}`,
        );
      }
    }
    console.log(
      `服务已安装并启动：${unit.file}
访问地址：http://${config.api.listen}
访问令牌：${config.api.token}
数据目录：${locations.root}`,
    );
  } else {
    if (!fs.existsSync(unit.file)) {
      throw new Error("服务未安装；先执行 agent install，或直接运行 agent serve");
    }
    if (command === "uninstall") {
      systemctl(unit, ["disable", "--now", "agentic"]);
      fs.unlinkSync(unit.file);
      systemctl(unit, ["daemon-reload"]);
      console.log("服务已移除，数据目录保留。");
    } else if (command === "status") {
      console.log(
        `状态：${systemctl(unit, ["is-active", "agentic"], true)}
单元文件：${unit.file}
访问地址：http://${config.api.listen}
数据目录：${locations.root}`,
      );
    } else {
      systemctl(unit, [command, "agentic"]);
    }
  }
}
