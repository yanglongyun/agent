import { configured } from "./config-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../index.js";
import { paths } from "../config.js";

test("记事本：新建、列表、读取、保存与删除笔记", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-notes-"));
  const config = {
    ...configured(),
    workdir: root,
    api: { listen: "127.0.0.1:0", token: "notes-test-access-token" },
  };
  const runtime = createServer({ p: paths({ AGENT_HOME: root }), config });
  const origin = await runtime.listen();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = async (route, method = "GET", payload) => {
    const response = await fetch(origin + route, {
      method,
      headers: {
        authorization: "Bearer notes-test-access-token",
        "content-type": "application/json",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: response.status, data: await response.json() };
  };

  assert.equal((await fetch(origin + "/api/notes")).status, 401);

  const created = await request("/api/notes", "POST", { title: "购物清单", body: "牛奶\n鸡蛋" });
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.data), ["id", "title", "body", "created_at", "updated_at"]);
  assert.equal(created.data.title, "购物清单");

  const list = await request("/api/notes");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.notes, [
    {
      id: created.data.id,
      title: "购物清单",
      preview: "牛奶 鸡蛋",
      created_at: created.data.created_at,
      updated_at: created.data.updated_at,
    },
  ]);

  const empty = await request("/api/notes", "POST", {});
  assert.equal(empty.status, 201);
  assert.equal(empty.data.title, "");

  const detail = await request(`/api/notes/${created.data.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.body, "牛奶\n鸡蛋");

  const saved = await request(`/api/notes/${created.data.id}`, "PUT", {
    title: "  周末采购  ",
    body: "牛奶、鸡蛋、面包",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.title, "周末采购");
  assert.equal(saved.data.body, "牛奶、鸡蛋、面包");
  assert.equal(saved.data.created_at, created.data.created_at);
  assert.ok(saved.data.updated_at >= created.data.updated_at);
  const ordered = await request("/api/notes");
  assert.deepEqual(
    ordered.data.notes.map((note) => note.id),
    [created.data.id, empty.data.id],
  );

  assert.equal((await request("/api/notes", "POST", { title: "x", extra: 1 })).status, 400);
  assert.equal((await request("/api/notes", "POST", { title: "长".repeat(121) })).status, 400);
  assert.equal((await request("/api/notes", "POST", { body: "a".repeat(129 * 1024) })).status, 400);
  assert.equal((await request(`/api/notes/${created.data.id}`, "PUT", {})).status, 400);
  assert.equal((await request("/api/notes/missing")).status, 404);
  assert.equal((await request("/api/notes/missing", "PUT", { title: "x" })).status, 404);
  assert.equal((await request("/api/notes/missing", "DELETE")).status, 404);

  const removed = await request(`/api/notes/${created.data.id}`, "DELETE");
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.data, { deleted: created.data.id });
  assert.deepEqual(
    (await request("/api/notes")).data.notes.map((note) => note.id),
    [empty.data.id],
  );
});
