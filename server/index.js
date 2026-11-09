import http from "node:http";
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, version, paths, loadConfig, validateConfig } from "./config.js";
import openDB from "./db.js";
import createApi from "./api/index.js";
import { fail, json } from "./api/http.js";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function createServer({ p = paths(), config = loadConfig(p) } = {}) {
  validateConfig(config);
  const publicDir = path.join(ROOT, "ui/dist");
  const db = openDB(p.db);
  let api;
  try {
    api = createApi({ db, paths: p, config, publicDir, version });
  } catch (error) {
    db.close();
    throw error;
  }
  const sockets = new Set();
  const server = http.createServer(
    { requestTimeout: 30000, maxHeaderSize: 16384 },
    async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        let parts;
        try {
          parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        } catch {
          fail(400, "URL 无效");
        }
        if (parts[0] === "api") {
          return await api.route(req, res, parts.slice(1));
        }
        if (url.pathname === "/healthz" && req.method === "GET") {
          return json(res, 200, { status: "ok" });
        }
        if (!["GET", "HEAD"].includes(req.method)) {
          fail(405, "不支持的方法");
        }
        if (parts.some((p) => p.startsWith(".") || /[\/\\\0]/.test(p))) {
          fail(404, "文件不存在");
        }
        // 页面路由返回同一份 UI 入口；资源文件和 API 仍按各自路径处理。
        let filename = path.join(publicDir, ...parts);
        const pageRoute =
          parts.length === 0 ||
          (parts.length === 1 && ["login", "settings"].includes(parts[0])) ||
          (parts.length === 2 && parts[0] === "sessions");
        if (pageRoute) {
          filename = path.join(publicDir, "index.html");
        }
        let real;
        try {
          real = await fs.realpath(filename);
        } catch {
          fail(404, "文件不存在");
        }
        const relative = path.relative(await fs.realpath(publicDir), real);
        if (
          relative.startsWith("..") ||
          path.isAbsolute(relative) ||
          !(await fs.stat(real)).isFile()
        ) {
          fail(404, "文件不存在");
        }
        const content = await fs.readFile(real);
        res.writeHead(200, {
          "content-type": mime[path.extname(real)] || "application/octet-stream",
          "x-content-type-options": "nosniff",
          "content-length": content.length,
          "cache-control":
            parts[0] === "assets" ? "public, max-age=31536000, immutable" : "no-cache",
        });
        res.end(req.method === "HEAD" ? undefined : content);
      } catch (error) {
        if (res.destroyed) {
          return;
        }
        if (res.headersSent) {
          return res.destroy();
        }
        json(res, error.status || 500, { error: error.message });
      }
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let closing = null;

  async function shutdown() {
    const closed = new Promise((resolve) => server.close(resolve));
    for (const socket of sockets) {
      socket.destroy();
    }
    await api.close();
    await closed;
    db.close();
  }

  return {
    server,
    db,
    listen(value = config.api.listen) {
      const match = /^(?:\[([^\]]+)\]|([^:]*)):(\d+)$/.exec(value);
      if (!match || Number(match[3]) > 65535) {
        throw new Error("监听地址无效");
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(Number(match[3]), match[1] || match[2] || "0.0.0.0", () => {
          server.off("error", reject);
          const address = server.address();
          resolve(
            `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`,
          );
        });
      });
    },
    close() {
      if (!closing) {
        closing = shutdown();
      }
      return closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { run } = await import("./scripts/cli.js");
  run(["serve", ...process.argv.slice(2)]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
