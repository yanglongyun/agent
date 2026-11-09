import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, mergeMessages, type RawMessage } from "../src/thread/thread";
import { checkAuth, logout, useAuth } from "../src/lib/auth";
import {
  send,
  retrySend,
  useThread,
  loadStatus,
  loadThreads,
  openThread,
  loadOlder,
  stopRun,
} from "../src/thread/store";
import { copyText } from "../src/lib/clipboard";

const call: RawMessage = {
  id: 1,
  item: { type: "function_call", call_id: "c1", name: "read", arguments: '{"path":"a.txt"}' },
};
const output: RawMessage = {
  id: 2,
  item: {
    type: "function_call_output",
    call_id: "c1",
    output: JSON.stringify({ success: true, text: '{"error":"ordinary file content"}' }),
  },
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("跨页调用与结果合并成一行，刷新保持稳定标识，文件 error 字段不表示工具失败", () => {
  const latest = buildRows([output]);
  const rows = buildRows(mergeMessages([call], [output]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, latest[0].key);
  assert.equal(rows[0].name, "read");
  assert.equal(rows[0].failed, false);
  assert.equal(rows[0].result, '{"error":"ordinary file content"}');
  const failed: RawMessage = {
    ...output,
    item: {
      type: "function_call_output",
      call_id: "c1",
      output: '{"success":false,"text":"退出码 1"}',
    },
  };
  assert.equal(buildRows([call, failed])[0].failed, true);
});
test("压缩记录按覆盖位置显示，加载更早历史后不重复", () => {
  const summaries = [{ id: 1, through_id: 2, summary: "摘要", created_at: 10 }];
  const last: RawMessage = {
    id: 3,
    item: { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
  };
  assert.deepEqual(
    buildRows([last], summaries).map((row) => row.key),
    ["compact:1", "message:3"],
  );
  assert.deepEqual(
    buildRows([call, output, last], summaries).map((row) => row.key),
    ["tool:c1", "compact:1", "message:3"],
  );
});
test("退出登录失败保持登录，身份检查区分网络故障与 401", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  useAuth.setState({ state: "in" });
  globalThis.fetch = async () => {
    throw new Error("网络断开");
  };
  assert.equal(await logout(), false);
  assert.equal(useAuth.getState().state, "in");
  await checkAuth();
  assert.equal(useAuth.getState().state, "error");
  assert.equal(useAuth.getState().error, "网络断开");
  globalThis.fetch = async () => json({ error: "unauthorized" }, 401);
  await checkAuth();
  assert.equal(useAuth.getState().state, "out");
  globalThis.fetch = async () => json({ ok: true });
  useAuth.setState({ state: "in" });
  assert.equal(await logout(), true);
  assert.equal(useAuth.getState().state, "out");
});
test("发送前检查失败不接管草稿、不发请求", (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => {
    throw new Error("不应该发送");
  };
  useThread.setState({ ready: true, busy: false, status: null, messages: [] });
  assert.equal(send("保留这段草稿"), false);
  assert.deepEqual(useThread.getState().messages, []);
  assert.equal(useThread.getState().busy, false);
});
test("状态和会话加载失败返回失败，保留已加载数据", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const threads = useThread.getState().threads;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await loadStatus(), false);
  assert.equal(await loadThreads(), false);
  assert.equal(useThread.getState().threads, threads);
});
test("打开会话读取压缩记录，分页后工具完整且展开状态保留", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/compactions")) {
      return json({ compactions: [{ id: 1, through_id: 2, summary: "摘要", created_at: 10 }] });
    }
    if (String(url).includes("before=")) {
      return json({ messages: [call], has_more: false });
    }
    return json({ messages: [output], has_more: true });
  };
  await openThread("test", true);
  useThread.setState({ expanded: { "tool:c1": true } });
  await loadOlder();
  const state = useThread.getState();
  assert.equal(state.compactions.length, 1);
  assert.equal(state.expanded["tool:c1"], true);
  const rows = buildRows(state.messages, state.compactions);
  assert.equal(rows.filter((row) => row.kind === "tool").length, 1);
  assert.equal(rows[0].name, "read");
});
test("复制等待剪贴板完成，拒绝时返回失败", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
  let resolve: () => void = () => {};
  const pending = new Promise<void>((finish) => {
    resolve = finish;
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: () => pending } },
  });
  let finished = false;
  const copying = copyText("hello").then((value) => {
    finished = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  resolve();
  assert.equal(await copying, true);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    },
  });
  assert.equal(await copyText("hello"), false);
});

test("回复通过 SSE 接管数据库 ID，保持实时 key，不再发起 GET", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const user = {
    type: "message" as const,
    role: "user" as const,
    content: [{ type: "input_text" as const, text: "question" }],
  };
  const assistant = {
    type: "message" as const,
    role: "assistant" as const,
    content: [{ type: "output_text" as const, text: "answer" }],
  };
  const events = [
    {
      type: "message",
      item: user,
      sequence: 0,
      created_at: 100,
      saved: [{ sequence: 0, id: 1, usage: null, created_at: 100 }],
    },
    { type: "message", delta: "ans" },
    { type: "message", delta: "wer" },
    { type: "message", item: assistant, sequence: 1, created_at: 101 },
    { type: "usage", usage: null, saved: [{ sequence: 1, id: 2, usage: null, created_at: 101 }] },
    { type: "done", status: "completed" },
  ];
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") {
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
    }
    throw new Error(`回复期间不应该重新请求 ${url}`);
  };
  useThread.setState({
    currentId: "test",
    ready: true,
    busy: false,
    messages: [],
    compactions: [],
    notes: [],
    status: {
      model_ready: true,
      version: "test",
      model: "test",
      url: "http://model",
      workdir: "",
      data_dir: "",
    },
  });
  assert.equal(send("question"), true);
  const userKey = useThread.getState().messages[0].key;
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const state = useThread.getState();
  assert.equal(state.busy, false);
  assert.deepEqual(state.notes, []);
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[0].key, userKey);
  assert.equal(state.messages[0].id, 1);
  assert.equal(buildRows(state.messages)[1].content, "answer");
});

test("新会话创建后通知路由，进入该 URL 不重置正在执行的回复", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const user = {
    type: "message" as const,
    role: "user" as const,
    content: [{ type: "input_text" as const, text: "new question" }],
  };
  const assistant = {
    type: "message" as const,
    role: "assistant" as const,
    content: [{ type: "output_text" as const, text: "answer" }],
  };
  let creations = 0;
  let routedId = "";
  globalThis.fetch = async (url, options) => {
    if (String(url) === "/api/sessions" && options?.method === "POST") {
      creations++;
      return json({
        id: "new-session",
        title: "",
        preview: "",
        created_at: 100,
        updated_at: 100,
        running: false,
      });
    }
    if (options?.method === "POST") {
      assert.equal(String(url), "/api/sessions/new-session/messages");
      return new Response(
        [
          {
            type: "message",
            item: user,
            sequence: 0,
            created_at: 100,
            saved: [{ sequence: 0, id: 1, usage: null, created_at: 100 }],
          },
          { type: "message", item: assistant, sequence: 1, created_at: 101 },
          {
            type: "usage",
            usage: null,
            saved: [{ sequence: 1, id: 2, usage: null, created_at: 101 }],
          },
          { type: "done", status: "completed" },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      );
    }
    throw new Error(`回复期间不应该重新请求 ${url}`);
  };
  useThread.setState({
    currentId: "",
    messages: [],
    compactions: [],
    notes: [],
    ready: true,
    busy: false,
    loadError: "",
    status: {
      model_ready: true,
      version: "test",
      model: "test",
      url: "http://model",
      workdir: "",
      data_dir: "",
    },
  });
  const generation = useThread.getState().generation;
  assert.equal(
    send("new question", null, (id) => {
      routedId = id;
      assert.equal(useThread.getState().currentId, id);
      void openThread(id);
      assert.equal(useThread.getState().generation, generation);
      assert.equal(useThread.getState().busy, true);
    }),
    true,
  );
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(creations, 1);
  assert.equal(routedId, "new-session");
  assert.equal(useThread.getState().busy, false);
  assert.equal(useThread.getState().messages.length, 2);
  assert.deepEqual(useThread.getState().notes, []);
});

test("不存在的会话保留 URL 对应 ID 并显示错误，不回退到其他会话", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => json({ error: "会话不存在" }, 404);
  await openThread("missing-session");
  assert.equal(useThread.getState().currentId, "missing-session");
  assert.equal(useThread.getState().loadError, "会话不存在");
  assert.deepEqual(useThread.getState().messages, []);
});

test("多轮工具和压缩通过 SSE 保存 ID、usage 和列表，终止时只丢弃未提交内容", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const user = { type: "message", role: "user", content: [{ type: "input_text", text: "work" }] };
  const tool = { type: "function_call", call_id: "new-call", name: "read", arguments: "{}" };
  const result = {
    type: "function_call_output",
    call_id: "new-call",
    output: '{"success":true,"text":"done"}',
  };
  const summary = { id: 9, through_id: 12, summary: "摘要", created_at: 120 };
  const session = {
    id: "test",
    title: "",
    preview: "work",
    created_at: 50,
    updated_at: 110,
    running: false,
  };
  const requests: string[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push(`${options?.method || "GET"} ${url}`);
    const events = [
      {
        type: "message",
        item: user,
        sequence: 0,
        created_at: 100,
        saved: [{ sequence: 0, id: 10, usage: null, created_at: 100 }],
        session: { ...session, running: true },
      },
      { type: "function_call", item: tool, sequence: 1, created_at: 101 },
      { type: "usage", usage: { total_tokens: 10 } },
      {
        type: "function_call_output",
        item: result,
        sequence: 2,
        created_at: 110,
        saved: [
          { sequence: 1, id: 11, usage: { total_tokens: 10 }, created_at: 101 },
          { sequence: 2, id: 12, usage: null, created_at: 110 },
        ],
        session: { ...session, running: true },
      },
      {
        type: "compact",
        status: "completed",
        start: 0,
        end: 3,
        item: { type: "message", role: "user", content: [{ type: "input_text", text: "摘要" }] },
        usage: null,
        compaction: summary,
      },
      { type: "message", delta: "不完整正文" },
      { type: "error", code: "model_incomplete", error: "未完成" },
      { type: "done", status: "incomplete", session },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  };
  useThread.setState({
    currentId: "test",
    ready: true,
    busy: false,
    messages: [],
    compactions: [],
    notes: [],
    hasMore: false,
    threads: [{ ...session, id: "other", updated_at: 1 }],
    status: {
      model_ready: true,
      version: "test",
      model: "test",
      url: "http://model",
      workdir: "",
      data_dir: "",
    },
  });
  assert.equal(send("work"), true);
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const state = useThread.getState();
  assert.equal(state.busy, false);
  assert.deepEqual(requests, ["POST /api/sessions/test/messages"]);
  assert.deepEqual(
    state.messages.map((entry) => entry.id),
    [10, 11, 12],
  );
  assert.deepEqual(state.messages[1].usage, { total_tokens: 10 });
  assert.deepEqual(state.compactions, [summary]);
  assert.deepEqual(state.threads[0], session);
  assert.equal(state.notes[0].content, "未完成");
  assert.equal(buildRows(state.messages, state.compactions).at(-1)?.key, "compact:9");
});

test("停止等待服务端确认，取消请求不会主动断开 SSE，也不重新查询", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array>;
  let requestSignal: AbortSignal | null | undefined;
  const requests: string[] = [];
  const session = {
    id: "test",
    title: "",
    preview: "stop",
    created_at: 1,
    updated_at: 2,
    running: false,
  };
  globalThis.fetch = async (url, options) => {
    requests.push(`${options?.method || "GET"} ${url}`);
    if (String(url).endsWith("/cancel")) {
      assert.equal(requestSignal?.aborted, false);
      stream.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "done", status: "aborted", session })}\n\n`),
      );
      stream.close();
      return json({ ok: true });
    }
    requestSignal = options?.signal;
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller;
        },
      }),
    );
  };
  useThread.setState({
    currentId: "test",
    ready: true,
    busy: false,
    messages: [],
    compactions: [],
    notes: [],
    threads: [],
    status: {
      model_ready: true,
      version: "test",
      model: "test",
      url: "http://model",
      workdir: "",
      data_dir: "",
    },
  });
  send("stop");
  await stopRun();
  assert.equal(useThread.getState().stopping, true);
  assert.deepEqual(requests, ["POST /api/sessions/test/messages"]);
  stream!.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ type: "message", item: { type: "message", role: "user", content: [{ type: "input_text", text: "stop" }] }, sequence: 0, created_at: 2, saved: [{ sequence: 0, id: 4, usage: null, created_at: 2 }] })}\n\n`,
    ),
  );
  stream!.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ type: "function_call", item: { type: "function_call", call_id: "pending", name: "shell", arguments: "{}" }, sequence: 1, created_at: 3 })}\n\n`,
    ),
  );
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const state = useThread.getState();
  assert.deepEqual(requests, [
    "POST /api/sessions/test/messages",
    "POST /api/sessions/test/cancel",
  ]);
  assert.equal(requestSignal?.aborted, false);
  assert.equal(state.busy, false);
  assert.deepEqual(
    state.messages.map((entry) => entry.id),
    [4],
  );
  assert.equal(state.notes[0].code, "stopped");
  assert.equal(state.threads[0].running, false);
});

test("连接中断只保留已确认记录，提示核对，不自动拉取历史", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const requests: string[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push(`${options?.method || "GET"} ${url}`);
    return new Response(
      [
        {
          type: "message",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: "work" }] },
          sequence: 0,
          created_at: 1,
          saved: [{ sequence: 0, id: 1, usage: null, created_at: 1 }],
        },
        { type: "message", delta: "半截正文" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    );
  };
  useThread.setState({
    currentId: "test",
    ready: true,
    busy: false,
    messages: [],
    compactions: [],
    notes: [],
    status: {
      model_ready: true,
      version: "test",
      model: "test",
      url: "http://model",
      workdir: "",
      data_dir: "",
    },
  });
  send("work");
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(requests, ["POST /api/sessions/test/messages"]);
  assert.deepEqual(
    useThread.getState().messages.map((entry) => entry.id),
    [1],
  );
  assert.match(useThread.getState().notes[0].content || "", /重新打开会话核对/);
});

test("图片消息限制五张，发送失败可携图重试，保存确认后替换成本地地址", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const images = Array(5).fill("data:image/png;base64,dGVzdA==");
  const localImages = images.map((_, index) => `/api/images/test-${index}.png`);
  useThread.setState({
    currentId: "images",
    messages: [],
    compactions: [],
    notes: [],
    ready: true,
    busy: false,
    status: {
      model_ready: true,
      version: "test",
      model: "test",
      url: "",
      workdir: "",
      data_dir: "",
    },
  });
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.deepEqual(JSON.parse(String(options?.body)), { text: "", images });
    if (requests === 1) {
      return json({ error: "上传失败" }, 500);
    }
    const item = {
      type: "message",
      role: "user",
      content: localImages.map((image_url) => ({ type: "input_image", image_url, detail: "auto" })),
    };
    return new Response(
      [
        {
          type: "message",
          item,
          sequence: 0,
          created_at: 10,
          saved: [{ sequence: 0, id: 1, usage: null, created_at: 10 }],
        },
        { type: "done", status: "completed" },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    );
  };
  assert.equal(send("", null, undefined, [...images, images[0]]), false);
  assert.equal(requests, 0);
  assert.equal(send("", null, undefined, images), true);
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const failed = buildRows(useThread.getState().messages)[0];
  assert.equal(failed.failed, true);
  assert.deepEqual(failed.images, images);
  assert.equal(retrySend(failed), true);
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(requests, 2);
  assert.deepEqual(buildRows(useThread.getState().messages)[0].images, localImages);
  assert.equal(useThread.getState().messages[0].id, 1);
  assert.equal(JSON.stringify(useThread.getState().messages).includes("base64"), false);
});
