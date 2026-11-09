import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "../index.js";
import { defaults, paths } from "../config.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";

const answer = (text) => ({
  output: [message(text, "output_text", "assistant")],
});
const events = (raw) =>
  raw
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)));

test("图片工具结果存文件地址，当前循环和数据库历史都转换为标准图片输入", async (t) => {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  let requests = 0;
  const f = await fixture(t, async (_config, input) => {
    requests++;
    if (requests === 1) {
      return {
        output: [
          {
            type: "function_call",
            call_id: "read_image",
            name: "read",
            arguments: JSON.stringify({ path: "sample.png" }),
          },
        ],
        usage: { total_tokens: 10 },
      };
    }
    // 第二次是工具循环，第三次是重新从数据库读取历史后发起的请求。
    const result = input.find((item) => item.type === "function_call_output");
    assert.equal(result.call_id, "read_image");
    assert.deepEqual(result.output, [
      {
        type: "input_text",
        text: JSON.stringify({ success: true, text: "已读取图片 sample.png" }),
      },
      {
        type: "input_image",
        image_url: `data:image/png;base64,${bytes.toString("base64")}`,
        detail: "auto",
      },
    ]);
    assert.equal(input.filter((item) => item.role === "user").length, requests - 1);
    const saved = f.runtime.db
      .prepare(
        "SELECT item FROM messages WHERE json_extract(item, '$.type') = 'function_call_output'",
      )
      .get();
    assert.ok(saved);
    assert.equal(saved.item.includes("data:image/"), false);
    if (requests === 2) {
      await fs.unlink(path.join(f.root, "sample.png"));
    }
    return answer("已查看图片");
  });
  await fs.writeFile(path.join(f.root, "sample.png"), bytes);
  const id = await f.newSession();
  const first = await f.request(`/api/sessions/${id}/messages`, "POST", { text: "看看图片" });
  const raw = await first.text();
  const stream = events(raw);
  assert.equal(stream.at(-1).status, "completed");
  assert.equal(raw.includes("data:image/"), false);
  assert.equal(
    stream.filter((event) => event.type === "message" && event.item?.role === "user").length,
    1,
  );
  const result = stream.find((event) => event.type === "function_call_output").item;
  const imageURL = result.output[1].image_url;
  assert.match(imageURL, /^\/api\/images\/[0-9a-f-]+\.png$/);
  assert.deepEqual(await fs.readFile(path.join(f.p.images, path.basename(imageURL))), bytes);
  const stored = await (await f.request(`/api/sessions/${id}/messages`)).json();
  assert.deepEqual(
    stored.messages.find((row) => row.item.type === "function_call_output").item,
    result,
  );

  assert.equal((await fetch(f.origin + imageURL)).status, 401);
  const login = await f.request("/api/auth/login", "POST", { token: f.config.api.token });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const image = await fetch(f.origin + imageURL, { headers: { cookie } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
  assert.equal((await f.request(imageURL, "HEAD")).status, 200);
  assert.equal((await f.request("/api/images/%2e%2e%2fconfig.json")).status, 404);
  assert.equal(
    (await f.request("/api/images/00000000-0000-0000-0000-000000000000.png")).status,
    404,
  );

  const next = await f.request(`/api/sessions/${id}/messages`, "POST", { text: "再描述一次" });
  assert.equal(events(await next.text()).at(-1).status, "completed");
  assert.equal(requests, 3);
  assert.equal(
    f.runtime.db.prepare("SELECT COUNT(*) n FROM messages WHERE item LIKE '%data:image/%'").get().n,
    0,
  );
});

async function fixture(t, respond, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-test-"));
  const p = paths({ AGENT_HOME: root });
  const config = {
    ...defaults(),
    key: "test-model-key",
    workdir: root,
    ...overrides,
    api: { listen: "127.0.0.1:0", token: "test-access-token-123456" },
  };
  config.url = await modelServer(t, (request, emit, signal) =>
    respond(config, request.input, request.tools, request.instructions, emit, signal),
  );
  const runtime = createServer({ p, config });
  const origin = await runtime.listen();
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const headers = {
    authorization: `Bearer ${config.api.token}`,
    "content-type": "application/json",
  };
  const request = (route, method = "GET", data, extra = {}) =>
    fetch(origin + route, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      ...extra,
    });
  const newSession = async () => {
    const r = await request("/api/sessions", "POST", {});
    assert.equal(r.status, 201);
    return (await r.json()).id;
  };
  return { root, p, config, runtime, origin, headers, request, newSession };
}

test("三张表字段、路由、鉴权、分页和删除", async (t) => {
  const f = await fixture(t, async () => answer("你好"));
  const columns = (table) =>
    f.runtime.db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => r.name);
  assert.deepEqual(columns("sessions"), ["id", "title", "created_at", "updated_at"]);
  assert.deepEqual(columns("messages"), ["id", "session_id", "item", "usage", "created_at"]);
  assert.deepEqual(columns("compactions"), [
    "id",
    "session_id",
    "through_id",
    "summary",
    "created_at",
  ]);
  const tables = f.runtime.db
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  assert.equal(tables.length, 3);
  for (const row of tables) {
    assert.doesNotMatch(row.sql, /FOREIGN|CHECK/i);
  }
  assert.equal((await fetch(f.origin + "/api/sessions")).status, 401);
  for (const route of ["/v1/sessions", "/auth/me", "/api/unknown", "/api/sessions/a/b/c"]) {
    assert.equal((await f.request(route)).status, 404);
  }
  assert.equal((await f.request("/api/sessions", "POST", { unexpected: true })).status, 400);
  const login = await fetch(f.origin + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: f.config.api.token }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(f.origin + "/api/auth/me", { headers: { cookie } })).status, 200);
  assert.equal(
    (
      await fetch(f.origin + "/api/sessions", {
        method: "POST",
        headers: { cookie, origin: "https://elsewhere.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  const id = await f.newSession();
  const base = `/api/sessions/${id}`;
  const reply = await f.request(base + "/messages", "POST", { text: "你好" });
  assert.equal(reply.headers.get("content-type"), "text/event-stream");
  assert.equal(events(await reply.text()).at(-1).status, "completed");
  const first = await (await f.request(base + "/messages?limit=1")).json();
  assert.equal(first.has_more, true);
  assert.equal(first.messages[0].item.role, "assistant");
  const older = await (
    await f.request(base + `/messages?before=${first.messages[0].id}&limit=1`)
  ).json();
  assert.equal(older.messages[0].item.role, "user");
  assert.equal(older.has_more, false);
  assert.equal((await f.request(base + "/messages?before=nope")).status, 400);
  await f.request(base, "PATCH", { title: "改名" });
  assert.equal((await (await f.request(base)).json()).title, "改名");
  const c = await (await f.request("/api/config")).json();
  assert.equal(c.key, undefined);
  assert.equal(c.api.token, undefined);
  assert.equal((await f.request("/api/config", "PUT", { api: { token: "bad" } })).status, 400);
  assert.equal((await f.request("/api/config", "PUT", { keep: 0 })).status, 400);
  assert.equal((await f.request("/api/config", "PUT", { run_timeout: 30 })).status, 200);
  assert.equal(JSON.parse(await fs.readFile(f.p.config)).run_timeout, 30);
  f.runtime.db
    .prepare("INSERT INTO compactions(session_id,through_id,summary,created_at) VALUES(?,?,?,?)")
    .run(id, 1, "摘要", Date.now());
  await f.request(base, "DELETE");
  for (const table of ["sessions", "messages", "compactions"]) {
    assert.equal(f.runtime.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  }
});

test("工具循环事件顺序和完整持久化", async (t) => {
  let round = 0;
  const f = await fixture(t, async (config, input, tools, instructions, delta) => {
    assert.equal(tools.length, 4);
    if (!round++) {
      return {
        output: [
          {
            type: "function_call",
            name: "write",
            call_id: "call-1",
            arguments: JSON.stringify({ path: "test.txt", content: "完成" }),
          },
        ],
      };
    }
    assert.equal(input.at(-1).type, "function_call_output");
    delta({ type: "message", delta: "完成" });
    return answer("完成");
  });
  const id = await f.newSession();
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", {
    text: "写文件",
  });
  const list = events(await response.text());
  assert.deepEqual(
    list.map((e) => e.type),
    [
      "message",
      "function_call",
      "usage",
      "function_call_output",
      "message",
      "message",
      "usage",
      "done",
    ],
  );
  assert.equal(await fs.readFile(path.join(f.root, "test.txt"), "utf8"), "完成");
  const rows = (await (await f.request(`/api/sessions/${id}/messages`)).json()).messages;
  assert.deepEqual(
    rows.map((r) => r.item.type),
    ["message", "function_call", "function_call_output", "message"],
  );
  assert.ok(rows.every((r) => r.id > 0 && r.created_at > 0));
  const saved = list.flatMap((event) => event.saved || []);
  assert.equal(saved.length, rows.length);
  for (let index = 0; index < saved.length; index++) {
    const event = list.find((entry) => entry.sequence === saved[index].sequence);
    assert.deepEqual(event.item, rows[index].item);
    assert.equal(event.created_at, rows[index].created_at);
    assert.deepEqual(saved[index], {
      sequence: index,
      id: rows[index].id,
      usage: rows[index].usage,
      created_at: rows[index].created_at,
    });
  }
  assert.equal(list[1].saved, undefined);
  assert.equal(list[2].saved, undefined);
  assert.equal(list[3].saved.length, 2);
  const sessions = (await (await f.request("/api/sessions")).json()).sessions;
  assert.deepEqual(
    list.at(-1).session,
    sessions.find((session) => session.id === id),
  );
});

test("最新摘要加后续消息；压缩表追加，原消息不删除", async (t) => {
  let summaries = 0;
  const inputs = [];
  const f = await fixture(
    t,
    async (config, input, tools) => {
      if (!tools.length) {
        return answer(`摘要${++summaries}`);
      }
      inputs.push(structuredClone(input));
      return { ...answer("收到"), usage: { total_tokens: 1000 } };
    },
    { compact_at: 1, keep: 2 },
  );
  const id = await f.newSession();
  for (let i = 0; i < 5; i++) {
    const r = await f.request(`/api/sessions/${id}/messages`, "POST", {
      text: `第${i}条`,
    });
    assert.equal(events(await r.text()).at(-1).status, "completed");
  }
  const all = f.runtime.db.prepare("SELECT * FROM messages WHERE session_id=? ORDER BY id").all(id);
  const compressed = f.runtime.db
    .prepare("SELECT * FROM compactions WHERE session_id=? ORDER BY id")
    .all(id);
  assert.equal(all.length, 10);
  assert.ok(compressed.length >= 2);
  for (const c of compressed) {
    assert.ok(all.some((r) => r.id === c.through_id));
  }
  assert.ok(inputs.at(-1)[0].content[0].text.includes(`摘要${summaries}`));
  assert.ok(compressed.at(-1).through_id > compressed[0].through_id);
  // Disable new compression; the next request must read exactly the latest snapshot + following rows.
  await f.request("/api/config", "PUT", { compact_at: 100000 });
  const before = compressed.at(-1);
  await (await f.request(`/api/sessions/${id}/messages`, "POST", { text: "继续" })).text();
  const expected = all.filter((r) => r.id > before.through_id).map((r) => JSON.parse(r.item));
  assert.deepEqual(inputs.at(-1).slice(1), [...expected, message("继续")]);
  assert.equal(inputs.at(-1)[0].content[0].text, before.summary);
});

test("连续压缩引用已经落库的工具消息", async (t) => {
  let round = 0;
  const f = await fixture(
    t,
    async (_config, _input, tools) => {
      if (!tools.length) {
        return answer("图像处理摘要");
      }
      if (round++ < 4) {
        return {
          output: [
            {
              type: "function_call",
              name: "read",
              call_id: `img-${round}`,
              arguments: '{"path":"tiny.png"}',
            },
          ],
          usage: { total_tokens: 1000 },
        };
      }
      return answer("全部完成");
    },
    { compact_at: 1, keep: 1 },
  );
  await fs.writeFile(path.join(f.root, "tiny.png"), Buffer.from("iVBORw0KGgo=", "base64"));
  const id = await f.newSession();
  const list = events(
    await (
      await f.request(`/api/sessions/${id}/messages`, "POST", {
        text: "看图片",
      })
    ).text(),
  );
  assert.equal(list.at(-1).status, "completed");
  const c = f.runtime.db.prepare("SELECT * FROM compactions ORDER BY id").all();
  assert.ok(c.length >= 2);
  for (const row of c) {
    assert.ok(row.through_id > 1);
    assert.ok(f.runtime.db.prepare("SELECT id FROM messages WHERE id=?").get(row.through_id));
  }
});

test("后续请求失败仍保留已完成的工具轮次和已保存的摘要", async (t) => {
  let round = 0;
  const f = await fixture(
    t,
    async (_config, _input, tools) => {
      if (!tools.length) {
        return answer("即将失败的摘要");
      }
      if (round++ === 0) {
        return {
          usage: { total_tokens: 1000 },
          output: [
            {
              type: "function_call",
              name: "write",
              call_id: "w",
              arguments: '{"path":"side-effect.txt","content":"保留"}',
            },
          ],
        };
      }
      assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 7);
      assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM compactions").get().n, 1);
      throw new Error("模型断开");
    },
    { compact_at: 1, keep: 1 },
  );
  const id = await f.newSession();
  for (let i = 0; i < 4; i++) {
    f.runtime.db
      .prepare("INSERT INTO messages(session_id,item,created_at) VALUES(?,?,?)")
      .run(id, JSON.stringify(message("以前" + i)), Date.now());
  }
  const list = events(
    await (await f.request(`/api/sessions/${id}/messages`, "POST", { text: "开始" })).text(),
  );
  assert.equal(list.at(-1).status, "incomplete");
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 7);
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM compactions").get().n, 1);
  assert.equal(await fs.readFile(path.join(f.root, "side-effect.txt"), "utf8"), "保留");
});

test("同会话互斥，独立会话可执行，取消等待清理完成", async (t) => {
  let notify;
  const started = new Promise((r) => {
    notify = r;
  });
  const f = await fixture(t, async (_config, input, _tools, _system, delta, signal) => {
    if (input[0].content[0].text === "快") {
      return answer("快回复");
    }
    delta({ type: "message", delta: "尚未完成" });
    notify();
    await delay(10000, null, { signal });
    return answer("不应发生");
  });
  const id = await f.newSession();
  const r = await f.request(`/api/sessions/${id}/messages`, "POST", {
    text: "慢",
  });
  const collected = r.text();
  await started;
  assert.equal(
    (await f.request(`/api/sessions/${id}/messages`, "POST", { text: "冲突" })).status,
    409,
  );
  assert.equal((await f.request(`/api/sessions/${id}`, "DELETE")).status, 409);
  const second = await f.newSession();
  assert.equal(
    events(
      await (
        await f.request(`/api/sessions/${second}/messages`, "POST", {
          text: "快",
        })
      ).text(),
    ).at(-1).status,
    "completed",
  );
  assert.equal((await f.request(`/api/sessions/${id}/cancel`, "POST", {})).status, 200);
  assert.equal(events(await collected).at(-1).status, "aborted");
  assert.equal((await (await f.request(`/api/sessions/${id}`)).json()).running, false);
  assert.equal((await (await f.request(`/api/sessions/${id}/messages`)).json()).messages.length, 1);
});

test("断开 HTTP 连接会中止模型请求", async (t) => {
  let notify;
  const aborted = new Promise((r) => {
    notify = r;
  });
  const f = await fixture(t, async (_c, _i, _t, _s, _d, signal) => {
    try {
      await delay(10000, null, { signal });
    } finally {
      if (signal.aborted) {
        notify();
      }
    }
    return answer("不应发生");
  });
  const id = await f.newSession();
  const abort = new AbortController();
  const response = await f.request(
    `/api/sessions/${id}/messages`,
    "POST",
    { text: "慢" },
    { signal: abort.signal },
  );
  const read = response.text().catch(() => {});
  abort.abort();
  await read;
  await Promise.race([
    aborted,
    delay(2000).then(() => {
      throw new Error("未收到中止");
    }),
  ]);
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
});

test("用户输入读取数据库 usage，摘要保存后才请求模型", async (t) => {
  let calls = 0;
  const f = await fixture(
    t,
    async (_config, input, tools) => {
      if (!tools.length) {
        assert.equal(calls, 2);
        return answer("请求前保存的摘要");
      }
      calls++;
      if (calls === 3) {
        const saved = f.runtime.db.prepare("SELECT * FROM compactions").all();
        assert.equal(saved.length, 1);
        assert.equal(saved[0].summary, f.config.compact_prefix + "请求前保存的摘要");
        assert.ok(input[0].content[0].text.includes(saved[0].summary));
      }
      return { ...answer("回答"), usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 } };
    },
    { compact_at: 10, keep: 1 },
  );
  const id = await f.newSession();
  for (let i = 0; i < 3; i++) {
    const response = await f.request(`/api/sessions/${id}/messages`, "POST", { text: `问题${i}` });
    const list = events(await response.text());
    assert.equal(list.at(-1).status, "completed");
    for (const event of list.filter(
      (event) => event.type === "compact" && event.status === "completed",
    )) {
      assert.deepEqual(event.compaction, {
        ...f.runtime.db.prepare("SELECT * FROM compactions WHERE id = ?").get(event.compaction.id),
      });
      assert.equal(event.compaction.summary, event.item.content[0].text);
    }
    if (i < 2) {
      assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM compactions").get().n, 0);
    }
  }
  const rows = (await (await f.request(`/api/sessions/${id}/messages`)).json()).messages;
  for (const row of rows) {
    if (row.item.role === "user") {
      assert.equal(row.usage, null);
    } else {
      assert.deepEqual(row.usage, { input_tokens: 8, output_tokens: 2, total_tokens: 10 });
    }
  }
});

test("工具轮次保存实际 usage，下一次模型请求前完成压缩", async (t) => {
  let calls = 0;
  const f = await fixture(
    t,
    async (_config, input, tools) => {
      if (!tools.length) {
        const rows = f.runtime.db.prepare("SELECT * FROM messages ORDER BY id").all();
        assert.equal(rows.length, 8);
        assert.equal(rows.at(-3).usage, null);
        assert.deepEqual(JSON.parse(rows.at(-2).usage), { total_tokens: 10 });
        assert.equal(rows.at(-1).usage, null);
        assert.equal(JSON.parse(rows.at(-1).item).type, "function_call_output");
        return answer("工具摘要");
      }
      calls++;
      if (calls === 1) {
        return {
          output: [
            { type: "reasoning", summary: [] },
            {
              type: "function_call",
              name: "write",
              call_id: "save",
              arguments: '{"path":"saved.txt","content":"完成"}',
            },
          ],
          usage: { total_tokens: 10 },
        };
      }
      assert.equal(calls, 2);
      assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM compactions").get().n, 1);
      assert.ok(input[0].content[0].text.includes("工具摘要"));
      assert.equal(input.at(-1).type, "function_call_output");
      return answer("完成");
    },
    { compact_at: 10, keep: 1 },
  );
  const id = await f.newSession();
  for (let i = 0; i < 4; i++) {
    f.runtime.db
      .prepare("INSERT INTO messages(session_id,item,created_at) VALUES(?,?,?)")
      .run(id, JSON.stringify(message(`旧问题${i}`)), Date.now());
  }
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", { text: "写文件" });
  assert.equal(events(await response.text()).at(-1).status, "completed");
  assert.equal(calls, 2);
});

test("最近响应没有 usage 时不使用更早的用量", async (t) => {
  let calls = 0;
  const f = await fixture(
    t,
    async (_config, _input, tools) => {
      assert.equal(tools.length, 4);
      calls++;
      if (calls === 1) {
        return { ...answer("第一次"), usage: { total_tokens: 100 } };
      }
      return answer("没有用量");
    },
    { compact_at: 1000, keep: 1 },
  );
  const id = await f.newSession();
  for (let i = 0; i < 3; i++) {
    if (i === 2) {
      await f.request("/api/config", "PUT", { compact_at: 10 });
    }
    const response = await f.request(`/api/sessions/${id}/messages`, "POST", { text: `消息${i}` });
    const list = events(await response.text());
    assert.equal(list.at(-1).status, "completed");
    assert.equal(
      list.some((event) => event.type === "error" || event.type === "compact"),
      false,
    );
  }
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM compactions").get().n, 0);
});

test("多个工具先交付完整调用和 usage，取消时不保存半轮结果", async (t) => {
  const f = await fixture(t, async () => ({
    output: [
      {
        type: "function_call",
        name: "write",
        call_id: "w",
        arguments: '{"path":"first.txt","content":"已执行"}',
      },
      {
        type: "function_call",
        name: "shell",
        call_id: "s",
        arguments: JSON.stringify({
          command: process.platform === "win32" ? "Start-Sleep -Seconds 10" : "sleep 10",
        }),
      },
    ],
    usage: { total_tokens: 30 },
  }));
  const id = await f.newSession();
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", { text: "运行" });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (!raw.includes('"type":"function_call_output"')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    raw += decoder.decode(chunk.value, { stream: true });
  }
  await f.request(`/api/sessions/${id}/cancel`, "POST", {});
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    raw += decoder.decode(chunk.value, { stream: true });
  }
  const list = events(raw);
  assert.deepEqual(
    list.map((event) => event.type),
    ["message", "function_call", "function_call", "usage", "function_call_output", "done"],
  );
  assert.equal(list.at(-1).status, "aborted");
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  assert.equal(list.flatMap((event) => event.saved || []).length, 1);
  assert.equal(list.at(-1).session.running, false);

  assert.equal(await fs.readFile(path.join(f.root, "first.txt"), "utf8"), "已执行");
});

test("模型 incomplete 不交付完整块、不执行工具、不保存半截输出", async (t) => {
  const f = await fixture(t, async (_config, _input, _tools, _instructions, onEvent) => {
    const call = {
      type: "function_call",
      name: "write",
      call_id: "w",
      arguments: '{"path":"invalid.txt","content":"不应写入"}',
    };
    onEvent({ type: "reasoning", delta: "尚未完成" });
    onEvent({ type: "response.output_item.done", item: call });
    return {
      status: "incomplete",
      output: [call],
      incomplete_details: { reason: "max_output_tokens" },
    };
  });
  const id = await f.newSession();
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", { text: "写文件" });
  const list = events(await response.text());
  assert.deepEqual(
    list.map((event) => event.type),
    ["message", "reasoning", "error", "done"],
  );
  assert.equal(list.at(-1).status, "incomplete");
  assert.equal(list.at(-1).stopReason, "max_output_tokens");
  assert.equal(list.at(-2).code, "model_incomplete");
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
  await assert.rejects(fs.access(path.join(f.root, "invalid.txt")));
});

test("删除会话清理图片快照；不存在的会话在各层返回 404", async (t) => {
  let round = 0;
  const f = await fixture(t, async () => {
    round++;
    if (round === 1) {
      return {
        output: [
          {
            type: "function_call",
            call_id: "snapshot",
            name: "read",
            arguments: '{"path":"sample.png"}',
          },
        ],
      };
    }
    return answer("done");
  });
  await fs.writeFile(path.join(f.root, "sample.png"), Buffer.from("image"));
  const id = await f.newSession();
  await (await f.request(`/api/sessions/${id}/messages`, "POST", { text: "read" })).text();
  assert.equal((await fs.readdir(f.p.images)).length, 1);
  assert.equal((await f.request(`/api/sessions/${id}`, "DELETE")).status, 200);
  assert.deepEqual(await fs.readdir(f.p.images), []);
  for (const suffix of ["", "/messages", "/compactions"]) {
    assert.equal((await f.request(`/api/sessions/${id}${suffix}`)).status, 404);
  }
  assert.equal((await f.request(`/api/sessions/${id}/cancel`, "POST")).status, 404);
});

test("取消半轮工具时清理尚未入库的图片快照", async (t) => {
  const f = await fixture(t, async () => ({
    output: [
      {
        type: "function_call",
        call_id: "snapshot",
        name: "read",
        arguments: '{"path":"sample.png"}',
      },
      {
        type: "function_call",
        call_id: "wait",
        name: "shell",
        arguments: JSON.stringify({
          command: process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30",
        }),
      },
    ],
  }));
  await fs.writeFile(path.join(f.root, "sample.png"), Buffer.from("image"));
  const id = await f.newSession();
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", {
    text: "read then wait",
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = "";
  while (!received.includes('"type":"function_call_output"')) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    received += decoder.decode(value);
  }
  assert.equal((await fs.readdir(f.p.images)).length, 1);
  await f.request(`/api/sessions/${id}/cancel`, "POST");
  await reader.cancel();
  assert.deepEqual(await fs.readdir(f.p.images), []);
  const records = await (await f.request(`/api/sessions/${id}/messages`)).json();
  assert.equal(records.messages.length, 1);
});

test("标题先去空白再校验；设置保存返回结果并通过 GET 读取", async (t) => {
  const f = await fixture(t, async () => answer("ok"));
  const title = "  " + "字".repeat(120) + "  ";
  const created = await (await f.request("/api/sessions", "POST", { title })).json();
  assert.equal(created.title, title.trim());
  assert.equal((await f.request(`/api/sessions/${created.id}`, "PATCH", { title })).status, 200);
  assert.equal(
    (await f.request("/api/config", "PUT", { context_window: 100, compact_at: 100 })).status,
    400,
  );
  const saved = await (
    await f.request("/api/config", "PUT", { context_window: 100, compact_at: 90 })
  ).json();
  assert.deepEqual(saved, { restart_required: false });
  const config = await (await f.request("/api/config")).json();
  assert.equal(config.context_window, 100);
  assert.equal(config.compact_at, 90);
});

test("页面深链接和刷新返回 UI，未知资源与 API 不返回 HTML", async (t) => {
  const f = await fixture(t, async () => answer("ok"));
  const root = await fetch(f.origin + "/");
  const html = await root.text();
  for (const route of [
    "/login",
    "/settings",
    "/sessions/example",
    "/sessions/example?view=history",
  ]) {
    const response = await fetch(f.origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(await response.text(), html);
    const head = await fetch(f.origin + route, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
  for (const route of [
    "/assets/missing.js",
    "/missing",
    "/sessions/example/extra",
    "/sessions/%2e%2e%2fconfig.json",
    "/api/unknown",
  ]) {
    const response = await f.request(route);
    assert.equal(response.status, 404, route);
    assert.match(response.headers.get("content-type"), /application\/json/);
  }
  assert.equal((await fetch(f.origin + "/settings", { method: "POST" })).status, 405);
});

test("事务失败不发送落库确认，done 仍返回会话最终状态", async (t) => {
  const f = await fixture(t, async () => answer("未保存的回答"));
  f.runtime.db.exec(`CREATE TRIGGER reject_answer BEFORE INSERT ON messages
    WHEN json_extract(NEW.item, '$.role') = 'assistant'
    BEGIN SELECT RAISE(ABORT, 'test write rejected'); END;`);
  const id = await f.newSession();
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", { text: "测试失败" });
  const list = events(await response.text());
  assert.equal(list.at(-1).status, "incomplete");
  assert.equal(list.at(-1).session.running, false);
  assert.ok(list.some((event) => event.type === "error"));
  const saved = list.flatMap((event) => event.saved || []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sequence, 0);
  const records = f.runtime.db.prepare("SELECT * FROM messages WHERE session_id = ?").all(id);
  assert.equal(records.length, 1);
  assert.equal(saved[0].id, records[0].id);
});

const uploadedPNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

test("用户一次上传五张图片，消息与 SSE 只存地址，下次请求仍能读取，删除会话清理文件", async (t) => {
  let requests = 0;
  const f = await fixture(t, async (_config, input) => {
    requests++;
    const parts = input[0].content;
    assert.equal(parts.length, 5);
    for (const part of parts) {
      assert.deepEqual(part, { type: "input_image", image_url: uploadedPNG, detail: "auto" });
    }
    return answer("已查看五张图片");
  });
  const id = await f.newSession();
  const base = `/api/sessions/${id}`;
  const response = await f.request(base + "/messages", "POST", {
    text: "",
    images: Array(5).fill(uploadedPNG),
  });
  assert.equal(response.status, 200);
  const raw = await response.text();
  assert.equal(raw.includes("base64"), false);
  const stream = events(raw);
  assert.equal(stream.at(-1).status, "completed");
  const user = stream[0].item;
  assert.equal(stream[0].session.preview, "[图片]");
  assert.equal(user.content.length, 5);
  const page = await (await f.request(base + "/messages")).json();
  assert.deepEqual(page.messages[0].item, user);
  assert.equal(
    f.runtime.db.prepare("SELECT COUNT(*) n FROM messages WHERE item LIKE '%base64%'").get().n,
    0,
  );
  assert.equal((await fs.readdir(f.p.images)).length, 5);
  for (const part of user.content) {
    const image = await f.request(part.image_url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.deepEqual(
      Buffer.from(await image.arrayBuffer()),
      Buffer.from(uploadedPNG.split(",")[1], "base64"),
    );
    assert.equal((await fetch(f.origin + part.image_url)).status, 401);
  }
  const next = await f.request(base + "/messages", "POST", { text: "再看一下", images: [] });
  assert.equal(events(await next.text()).at(-1).status, "completed");
  assert.equal(requests, 2);
  assert.equal((await (await f.request("/api/sessions")).json()).sessions[0].preview, "[图片]");
  assert.equal((await f.request(base, "DELETE")).status, 200);
  assert.deepEqual(await fs.readdir(f.p.images), []);
});

test("图片数量、类型、编码、大小和空消息在入库前检查", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("无效输入不应请求模型");
  });
  const id = await f.newSession();
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
  oversized.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const cases = [
    { data: { text: "", images: [] }, status: 400 },
    { data: { text: "看图", images: Array(6).fill(uploadedPNG) }, status: 400 },
    { data: { text: "看图", images: "invalid" }, status: 400 },
    { data: { text: "看图", images: [null] }, status: 400 },
    {
      data: { text: "看图", images: [uploadedPNG, "data:image/png;base64,aGVsbG8="] },
      status: 400,
    },
    {
      data: { text: "看图", images: [uploadedPNG.replace("image/png", "image/jpeg")] },
      status: 400,
    },
    { data: { text: "看图", images: ["data:image/svg+xml;base64,PHN2Zy8+"] }, status: 400 },
    { data: { text: "看图", images: ["/api/images/existing.png"] }, status: 400 },
    {
      data: { text: "看图", images: ["data:image/png;base64," + oversized.toString("base64")] },
      status: 413,
    },
  ];
  for (const entry of cases) {
    const response = await f.request(`/api/sessions/${id}/messages`, "POST", entry.data);
    assert.equal(response.status, entry.status);
    await response.text();
  }
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
  assert.deepEqual(
    await fs.readdir(f.p.images).catch((error) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }),
    [],
  );
});

test("用户消息保存失败时清理上传文件；模型失败时保留已提交的用户图片", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("模型拒绝图片");
  });
  const id = await f.newSession();
  f.runtime.db.exec(
    "CREATE TRIGGER reject_user BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const failed = await f.request(`/api/sessions/${id}/messages`, "POST", {
    text: "看图",
    images: [uploadedPNG],
  });
  assert.equal(failed.status, 500);
  await failed.text();
  assert.deepEqual(await fs.readdir(f.p.images), []);
  f.runtime.db.exec("DROP TRIGGER reject_user");
  const response = await f.request(`/api/sessions/${id}/messages`, "POST", {
    text: "看图",
    images: [uploadedPNG],
  });
  const stream = events(await response.text());
  assert.equal(stream.at(-1).status, "incomplete");
  assert.equal(stream[0].saved.length, 1);
  assert.equal((await fs.readdir(f.p.images)).length, 1);
  assert.equal(f.runtime.db.prepare("SELECT COUNT(*) n FROM messages").get().n, 1);
});
