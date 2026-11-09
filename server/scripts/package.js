import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, version } from "../config.js";

// Runtime pin is intentional: releases ship the exact version tested by CI.
const nodeVersion = "22.23.1";
const args = process.argv.slice(2);
const local = args.includes("--local");
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const platform = option("--platform", process.platform === "win32" ? "windows" : process.platform);
const arch = option("--arch", process.arch === "x64" ? "amd64" : process.arch);
if (!["linux", "darwin", "windows"].includes(platform) || !["amd64", "arm64"].includes(arch)) {
  throw new Error("支持 linux/darwin/windows × amd64/arm64");
}
if (
  local &&
  (platform !== (process.platform === "win32" ? "windows" : process.platform) ||
    arch !== (process.arch === "x64" ? "amd64" : process.arch))
) {
  throw new Error("--local 只能打包当前平台");
}
const windows = platform === "windows";
const suffix = windows ? "zip" : "tar.gz";
const archiveName = `agent_${platform}_${arch}.${suffix}`;
const dist = path.join(ROOT, "server/dist");
await fs.mkdir(dist, { recursive: true });
const staging = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-package-"));
const app = path.join(staging, "agentic");
await fs.mkdir(app);
function run(command, args, cwd = staging) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`${command} 失败`);
  }
}
const psQuote = (value) => "'" + value.replace(/'/g, "''") + "'";
const powershell = (command) =>
  run("powershell.exe", ["-NoProfile", "-Command", "$ErrorActionPreference='Stop'; " + command]);
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) {
    throw new Error(`下载失败：${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
try {
  for (const item of [
    "package.json",
    "LICENSE",
    "README.md",
    "agent",
    "agent.cmd",
    "server",
    "ui/dist",
  ]) {
    await fs.mkdir(path.dirname(path.join(app, item)), { recursive: true });
    await fs.cp(path.join(ROOT, item), path.join(app, item), {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(path.join(ROOT, "server"), source);
        const parts = relative.split(path.sep);
        if (["dist", "tests", "node_modules"].includes(parts[0])) {
          return false;
        }
        if (parts[0] === "scripts" && parts.length > 1) {
          return ["cli.js", "service.js"].includes(parts[1]);
        }
        return true;
      },
    });
  }
  await fs.access(path.join(app, "ui/dist/index.html"));
  const runtime = path.join(app, "runtime");
  await fs.mkdir(runtime);
  if (local) {
    if (!windows) {
      await fs.mkdir(path.join(runtime, "bin"));
    }
    await fs.copyFile(process.execPath, path.join(runtime, windows ? "node.exe" : "bin/node"));
    // Include the complete Node license even in local artifacts.
    await fs.writeFile(
      path.join(runtime, "LICENSE"),
      await download(
        `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
      ),
    );
  } else {
    const nodePlatform = windows ? "win" : platform;
    const nodeArch = arch === "amd64" ? "x64" : arch;
    const name = `node-v${nodeVersion}-${nodePlatform}-${nodeArch}`;
    const filename = `${name}.${suffix}`;
    const base = `https://nodejs.org/dist/v${nodeVersion}`;
    const checksums = (await download(`${base}/SHASUMS256.txt`)).toString();
    const expected = checksums
      .split("\n")
      .find((line) => line.trim().endsWith(" " + filename))
      ?.trim()
      .split(/\s+/)[0];
    if (!expected) {
      throw new Error(`Node 官方校验清单缺少 ${filename}`);
    }
    const bytes = await download(`${base}/${filename}`);
    if (createHash("sha256").update(bytes).digest("hex") !== expected) {
      throw new Error("Node 运行环境校验失败");
    }
    const downloaded = path.join(staging, filename);
    await fs.writeFile(downloaded, bytes);
    if (windows && process.platform === "win32") {
      powershell(
        `Expand-Archive -LiteralPath ${psQuote(downloaded)} -DestinationPath ${psQuote(staging)}`,
      );
    } else if (windows) {
      run("unzip", ["-q", downloaded, "-d", staging]);
    } else {
      run("tar", ["-xzf", downloaded, "-C", staging]);
    }
    if (!windows) {
      await fs.mkdir(path.join(runtime, "bin"));
    }
    await fs.copyFile(
      path.join(staging, name, windows ? "node.exe" : "bin/node"),
      path.join(runtime, windows ? "node.exe" : "bin/node"),
    );
    await fs.copyFile(path.join(staging, name, "LICENSE"), path.join(runtime, "LICENSE"));
  }
  if (!windows) {
    await fs.chmod(path.join(app, "agent"), 0o755);
    await fs.chmod(path.join(runtime, "bin/node"), 0o755);
  }
  await fs.writeFile(
    path.join(app, "release.json"),
    JSON.stringify(
      {
        version,
        node: local ? process.versions.node : nodeVersion,
        platform,
        arch,
      },
      null,
      2,
    ) + "\n",
  );
  const archive = path.join(dist, archiveName);
  await fs.rm(archive, { force: true });
  if (windows && process.platform === "win32") {
    powershell(
      `Compress-Archive -LiteralPath ${psQuote(app)} -DestinationPath ${psQuote(archive)}`,
    );
  } else if (windows) {
    run("zip", ["-qr", archive, "agentic"]);
  } else {
    run("tar", ["-czf", archive, "agentic"]);
  }
  const hash = createHash("sha256")
    .update(await fs.readFile(archive))
    .digest("hex");
  await fs.writeFile(`${archive}.sha256`, `${hash}  ${archiveName}\n`);
  console.log(
    `已打包：${archive}\n包含 Node.js ${local ? process.versions.node : nodeVersion}、JS 后端和前端。`,
  );
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
