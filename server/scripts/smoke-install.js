// Install the real archive into a temporary directory, with system Node hidden.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { ROOT, version } from "../config.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic install's smoke-"));
const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "x64" ? "amd64" : process.arch;
const artifact = `agent_${platform}_${arch}.${platform === "windows" ? "zip" : "tar.gz"}`;
let corrupt = false;
let running;
const server = http.createServer(async (req, res) => {
  try {
    const name = req.url.slice(1);
    if (![artifact, artifact + ".sha256"].includes(name)) {
      res.writeHead(404);
      return res.end();
    }
    if (corrupt && name.endsWith(".sha256")) {
      return res.end("0".repeat(64) + "  " + artifact + "\n");
    }
    res.end(await fs.readFile(path.join(ROOT, "server/dist", name)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const env = {
  ...process.env,
  AGENT_HOME: path.join(root, "data"),
  AGENT_BIN_DIR: path.join(root, "bin"),
  AGENT_INSTALL_DIR: path.join(root, "program"),
  AGENT_NO_SERVICE: "1",
  AGENT_NO_PATH: "1",
  AGENT_SERVER_TOKEN: "smoke-test-token-1234567890",
  AGENT_RELEASE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
};
if (process.platform !== "win32") {
  env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
} else {
  env.PATH = [
    env.SystemRoot,
    env.SystemRoot + "\\System32",
    env.SystemRoot + "\\System32\\WindowsPowerShell\\v1.0",
  ].join(";");
}
function run(command, args, expected = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      cwd: ROOT,
      windowsHide: true,
      windowsVerbatimArguments: command === "cmd.exe",
    });
    let out = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      out += c;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === expected
        ? resolve(out)
        : reject(new Error(`退出码 ${code}，预期 ${expected}\n${out}`)),
    );
  });
}
const windows = process.platform === "win32";
const launcher = path.join(env.AGENT_BIN_DIR, windows ? "agent.cmd" : "agent");
const launch = (args) =>
  windows ? ["cmd.exe", ["/d", "/s", "/c", `""${launcher}" ${args.join(" ")}"`]] : [launcher, args];
async function install(expected = 0) {
  return windows
    ? run(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "install.ps1")],
        expected,
      )
    : run("/bin/sh", [path.join(ROOT, "install.sh")], expected);
}
try {
  await install();
  assert.ok((await run(...launch(["version"]))).includes(`agent ${version}`));
  await run(...launch(["token"]));
  await fs.writeFile(path.join(env.AGENT_HOME, "preserved.txt"), "existing data");
  await install();
  assert.equal(
    await fs.readFile(path.join(env.AGENT_HOME, "preserved.txt"), "utf8"),
    "existing data",
  );
  corrupt = true;
  await install(1);
  corrupt = false;
  assert.ok((await run(...launch(["version"]))).includes(`agent ${version}`));
  const [command, args] = launch(["serve", "--listen", "127.0.0.1:0"]);
  running = spawn(command, args, {
    env,
    cwd: root,
    windowsHide: true,
    windowsVerbatimArguments: command === "cmd.exe",
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("安装包启动超时")), 10000);
    running.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    running.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    running.stderr.on("data", () => {});
    running.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出：${code}`));
    });
  });
  assert.equal((await fetch(url + "/healthz")).status, 200);
  const headers = { authorization: `Bearer ${env.AGENT_SERVER_TOKEN}` };
  const created = await fetch(url + "/api/sessions", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ title: "安装测试" }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const list = await (await fetch(url + "/api/sessions", { headers })).json();
  assert.equal(list.sessions[0].id, id);
  assert.match(await (await fetch(url)).text(), /<html/);
  const messages = await (await fetch(url + `/api/sessions/${id}/messages`, { headers })).json();
  assert.deepEqual(messages.messages, []);
  await fs.access(path.join(env.AGENT_HOME, "chat.db"));
  assert.equal((await fetch(url + "/api/unknown", { headers })).status, 404);
  console.log(
    "安装包验证通过：全新安装、重复安装、坏校验拒绝、保留数据、自带 Node.js 启动、界面、会话 API、SQLite。",
  );
} finally {
  if (running && running.exitCode === null) {
    const exited = new Promise((resolve) => running.once("exit", resolve));
    if (windows) {
      await run("taskkill", ["/pid", String(running.pid), "/T", "/F"]).catch(() => running.kill());
    } else {
      running.kill("SIGTERM");
    }
    await exited;
  }
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
