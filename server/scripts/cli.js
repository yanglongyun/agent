#!/usr/bin/env node
import { paths, loadConfig, saveConfig, newToken, version } from "../config.js";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import os from "node:os";

export async function run(args = process.argv.slice(2)) {
  const [command = "help", ...rest] = args;
  if (["version", "-v", "--version"].includes(command)) {
    console.log(`agent ${version}`);
    return;
  }
  if (["help", "-h", "--help"].includes(command)) {
    console.log(
      `agent ${version} — JavaScript / Node.js

用法：
  agent ask --model 标识 --compact-model 标识 [--workdir 目录] <问题>  在终端向 Agent 提问
  agent serve [--listen 地址]    前台运行 Web 服务
  agent install [--listen 地址]  安装并启动系统服务（Linux systemd）
  agent uninstall               停止并移除系统服务，保留数据
  agent start | stop | restart   控制系统服务
  agent status                  查看服务状态
  agent token [reset]            查看或重置访问令牌
  agent version                 查看版本

数据目录：${paths().root}`,
    );
    return;
  }
  if (
    ![
      "ask",
      "serve",
      "install",
      "uninstall",
      "start",
      "stop",
      "restart",
      "status",
      "token",
    ].includes(command)
  ) {
    throw new Error(`未知命令 ${command}；运行 agent help 查看命令`);
  }
  let listen;
  let askOptions;
  if (command === "ask") {
    const words = [...rest];
    askOptions = {};
    while (words[0]?.startsWith("--")) {
      const option = words.shift();
      const split = option.indexOf("=");
      const flag = split >= 0 ? option.slice(0, split) : option;
      const value = split >= 0 ? option.slice(split + 1) : words.shift();
      if (!value) {
        throw new Error(`${flag} 缺少值`);
      }
      switch (flag) {
        case "--model":
          askOptions.modelId = value;
          break;
        case "--compact-model":
          askOptions.compactModelId = value;
          break;
        case "--workdir":
          askOptions.workdir = value;
          break;
        default:
          throw new Error(`未知参数 ${flag}`);
      }
    }
    askOptions.prompt = words.join(" ");
  } else if (command === "serve" || command === "install") {
    if (rest.length === 2 && rest[0] === "--listen") {
      listen = rest[1];
    } else if (rest.length === 1 && rest[0].startsWith("--listen=")) {
      listen = rest[0].slice(9);
    } else if (rest.length) {
      throw new Error(`用法：agent ${command} [--listen 地址]`);
    }
  } else if (command !== "token" && rest.length) {
    throw new Error(`${command} 不接受额外参数`);
  }
  const locations = paths();
  const config = loadConfig(locations);
  if (command === "ask") {
    const ask = (await import("./ask.js")).default;
    const result = await ask(askOptions.prompt, config, { ...askOptions, locations });
    if (result.status !== "completed") {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "token") {
    if (rest.length && (rest.length !== 1 || rest[0] !== "reset")) {
      throw new Error("用法：agent token [reset]");
    }
    if (rest[0] === "reset") {
      config.api.token = newToken();
      saveConfig(locations, config);
      console.error(
        "令牌已更新，重启服务后生效：agent restart；如设置了 AGENT_SERVER_TOKEN，需同步更新该环境变量。",
      );
    }
    console.log(config.api.token);
    return;
  }
  if (command !== "serve") {
    const { service } = await import("./service.js");
    return service(command, locations, config, listen);
  }
  if (listen !== undefined) {
    config.api.listen = listen;
  }
  const { createServer } = await import("../index.js");
  const runtime = createServer({ p: locations, config });
  let url;
  try {
    url = await runtime.listen();
  } catch (error) {
    await runtime.close();
    throw error;
  }
  const address = runtime.server.address();
  const urls = [url];
  if (["0.0.0.0", "::"].includes(address.address)) {
    urls[0] = `http://127.0.0.1:${address.port}`;
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries) {
        if (!entry.internal && entry.family === "IPv4") {
          urls.push(`http://${entry.address}:${address.port}`);
        }
      }
    }
  }
  console.log(
    `agent ${version}
${urls.map((u) => "访问地址：" + u).join("\n")}
访问令牌：${config.api.token}
数据目录：${locations.root}
登录后请在设置中填写模型接口地址、API Key 和模型名称。`,
  );
  const stop = () => {
    runtime.close().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return runtime;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
