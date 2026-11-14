import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, mergeMessages, type RawMessage } from "../src/thread/thread";
import { checkAuth, logout, useAuth } from "../src/lib/auth";
import {
  send,
  selectedModel,
  selectModel,
  retrySend,
  useThread,
  loadStatus,
  openThread,
  loadOlder,
  stopRun,
  updateSessionCost,
  branchThread,
  compareThreads,
  isPinned,
  pinThread,
  setPinnedThreads,
  receiveFrame,
  startEvents,
  dispose,
} from "../src/thread/store";
import type { StreamEvent, GlobalFrame } from "../src/thread/stream";
import { validateAttachments, isImageAttachment } from "../src/thread/attachments";
import { nextPinnedIds, samePinnedIds } from "../src/shell/pinned";
import { copyText } from "../src/lib/clipboard";
import { usageSummary, costLabel } from "../src/thread/metering";

const sessionCost = {
  cost: { amount: 0, currency: "USD", unpriced_requests: 0 },
  request_count: 0,
};
const testSession = {
  id: "test",
  title: "",
  preview: "",
  running: false,
  pinned: null,
  created_at: 1,
  updated_at: 1,
  ...sessionCost,
};

let cursor = 0;
function pushEvent(event: StreamEvent, id = useThread.getState().currentId, runId = "test-run") {
  receiveFrame({ epoch: "test", cursor: ++cursor, session_id: id, run_id: runId, event });
}
function acceptEvents(events: unknown[]) {
  for (const event of events) {
    pushEvent(event as StreamEvent);
  }
  const user = events.find(
    (event: any) => event.type === "message" && event.item?.role === "user",
  ) as any;
  const record = user?.saved?.[0];
  return json(
    {
      epoch: "test",
      cursor,
      run_id: "test-run",
      message: { id: record?.id, item: user?.item, meta: user?.meta, created_at: user?.created_at },
      session: { ...testSession, id: useThread.getState().currentId, running: true },
    },
    202,
  );
}
function page(messages: RawMessage[], session = testSession, extra: Record<string, unknown> = {}) {
  return {
    epoch: "test",
    cursor,
    run_id: null,
    pending: [],
    reply_result: null,
    compactions: [],
    messages,
    session,
    has_more: false,
    ...extra,
  };
}
test.beforeEach(() => {
  dispose();
  cursor = 0;
  useThread.setState({
    connected: true,
    epoch: "test",
    cursor: 0,
    threads: [],
    currentId: "",
    ready: true,
    status: {
      version: "test",
      models: [
        { id: "test", name: "测试模型", model: "test", protocol: "responses", context_window: 0 },
      ],
      workdir: "",
      data_dir: "",
    },
  });
  selectModel("test");
});
test.afterEach(() => {
  dispose();
});

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
test("状态加载失败保留已加载数据", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const threads = useThread.getState().threads;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await loadStatus(), false);
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
      return json(page([call]));
    }
    return json(
      page([output], testSession, {
        has_more: true,
        compactions: [{ id: 1, through_id: 2, summary: "摘要", created_at: 10 }],
      }),
    );
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
      return acceptEvents(events);
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
      version: "test",
      models: [
        { id: "test", name: "测试模型", model: "test", protocol: "responses", context_window: 0 },
      ],
      workdir: "",
      data_dir: "",
    },
  });
  selectModel("test");
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
      return acceptEvents([
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
      ]);
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
      version: "test",
      models: [
        { id: "test", name: "测试模型", model: "test", protocol: "responses", context_window: 0 },
      ],
      workdir: "",
      data_dir: "",
    },
  });
  selectModel("test");
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
  const meta = {
    environment: {
      os: "darwin",
      arch: "arm64",
      host: "test-host",
      user: "test-user",
      workdir: "/test-workdir",
      time: "2026-11-10T00:00:00.000Z",
    },
  };
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
    ...sessionCost,
  };
  const requests: string[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push(`${options?.method || "GET"} ${url}`);
    const events = [
      {
        type: "message",
        item: user,
        meta,
        sequence: 0,
        created_at: 100,
        saved: [{ sequence: 0, id: 10, meta, usage: null, created_at: 100 }],
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
      {
        type: "message",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "任务完成结果" }],
        },
        meta: { task_results: ["child-task"] },
        sequence: 3,
        created_at: 121,
        saved: [
          {
            sequence: 3,
            id: 13,
            meta: { task_results: ["child-task"] },
            usage: null,
            created_at: 121,
          },
        ],
      },
      { type: "message", delta: "不完整正文" },
      { type: "error", code: "model_incomplete", error: "未完成" },
      { type: "done", status: "incomplete", session },
    ];
    return acceptEvents(events);
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
      version: "test",
      models: [
        { id: "test", name: "测试模型", model: "test", protocol: "responses", context_window: 0 },
      ],
      workdir: "",
      data_dir: "",
    },
  });
  selectModel("test");
  assert.equal(send("work"), true);
  for (let attempt = 0; attempt < 100 && useThread.getState().busy; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const state = useThread.getState();
  assert.equal(state.busy, false);
  assert.deepEqual(requests, ["POST /api/sessions/test/messages"]);
  assert.deepEqual(
    state.messages.map((entry) => entry.id),
    [10, 11, 12, 13],
  );
  assert.deepEqual(state.messages[0].meta, meta);
  assert.deepEqual(state.messages[0].item, user);
  assert.deepEqual(state.messages[3].meta, { task_results: ["child-task"] });
  const userRow = buildRows(state.messages).find((row) => row.kind === "user");
  assert.equal(userRow?.content, "work");
  assert.deepEqual(state.messages[1].usage, { total_tokens: 10 });
  assert.deepEqual(state.compactions, [summary]);
  assert.deepEqual(state.threads[0], session);
  assert.equal(state.notes[0].content, "未完成");
  assert.equal(buildRows(state.messages, state.compactions).at(-1)?.key, "compact:9");
});

test("回答用量保留厂商字段，多次请求汇总显示，悬浮保留各原始对象", () => {
  const usage = { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 100 };
  const summary = usageSummary([{ usage }]);
  assert.deepEqual(summary.tokens, ["输入 5", "输出 3", "缓存读取 100"]);
  assert.equal(summary.raw, usage);
  assert.equal(summary.missing, 1);
  const multiple = usageSummary([{ usage }, { usage: { input_tokens: 2, output_tokens: 1 } }]);
  assert.deepEqual(multiple.tokens, ["输入 7", "输出 4", "缓存读取 100"]);
  assert.deepEqual(multiple.raw, [usage, { input_tokens: 2, output_tokens: 1 }]);
  assert.equal(usage.input_tokens, 5);
  assert.equal("total_tokens" in usage, false);
});

test("Chat 用量显示原生 prompt/completion 计数，悬浮对象不改名", () => {
  const usage = {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_tokens_details: { cached_tokens: 50 },
  };
  const summary = usageSummary([{ usage }]);
  assert.deepEqual(summary.tokens, ["输入 100", "输出 20", "合计 120"]);
  assert.equal(summary.raw, usage);
  assert.equal("input_tokens" in usage, false);
});

test("用量附在工具调用最后一块时仍生成独立显示行，分页配对不复制用量", () => {
  const usage = { total_tokens: 100 };
  const rows = buildRows([{ ...call, usage }, output]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["tool", "usage"],
  );
  assert.deepEqual(rows[1].usageRecord?.usage, usage);
  assert.equal(rows[0].status, "done");
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
      version: "test",
      models: [
        { id: "test", name: "测试模型", model: "test", protocol: "responses", context_window: 0 },
      ],
      workdir: "",
      data_dir: "",
    },
  });
  selectModel("test");
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.deepEqual(JSON.parse(String(options?.body)), {
      text: "",
      model_id: "test",
      compact_model_id: "test",
      images,
      attachments: [],
    });
    if (requests === 1) {
      return json({ error: "上传失败" }, 500);
    }
    const item = {
      type: "message",
      role: "user",
      content: localImages.map((image_url) => ({ type: "input_image", image_url, detail: "auto" })),
    };
    return acceptEvents([
      {
        type: "message",
        item,
        sequence: 0,
        created_at: 10,
        saved: [{ sequence: 0, id: 1, usage: null, created_at: 10 }],
      },
      { type: "done", status: "completed" },
    ]);
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

test("会话金额保留微小费用，未计费请求不会伪装成完整的零费用", () => {
  assert.equal(
    costLabel({
      cost: { amount: 0.000000001, currency: "USD", unpriced_requests: 0 },
      request_count: 1,
    }),
    "预估 USD 0.000000001",
  );
  assert.equal(
    costLabel({ cost: { amount: 0, currency: "USD", unpriced_requests: 2 }, request_count: 2 }),
    "2 次请求尚未计费",
  );
  assert.equal(
    costLabel({ cost: { amount: 0.12, currency: "USD", unpriced_requests: 1 }, request_count: 3 }),
    "预估 USD 0.120000 · 1 次请求尚未计费",
  );
});

test("会话总金额从服务端读取，包含未加载历史；旧子任务快照和重复快照不回退或重复累加", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const session = {
    ...testSession,
    id: "cost-session",
    cost: { amount: 0.4, currency: "USD", unpriced_requests: 0 },
    request_count: 4,
  };
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes("/messages?limit="));
    return json(page([], session, { has_more: true }));
  };
  await openThread(session.id, true);
  assert.deepEqual(
    useThread.getState().threads.find((thread) => thread.id === session.id)?.cost,
    session.cost,
  );
  const latest = {
    id: session.id,
    cost: { amount: 0.6, currency: "USD", unpriced_requests: 1 },
    request_count: 7,
  };
  updateSessionCost(latest);
  updateSessionCost(latest);
  updateSessionCost({ ...session, request_count: 5 });
  await openThread(session.id, true);
  const stored = useThread.getState().threads.find((thread) => thread.id === session.id);
  assert.deepEqual(stored?.cost, latest.cost);
  assert.equal(stored?.request_count, 7);
});

test("分支使用回答的真实消息 ID，防止重复点击，成功加入列表但不改写原对话", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const row: RawMessage = {
    id: 42,
    item: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "已保存的回答" }],
    },
  };
  assert.equal(buildRows([row])[0].messageId, 42);
  useThread.setState({
    currentId: "test",
    busy: false,
    branchingMessageId: 0,
    messages: [row],
    threads: [testSession],
  });
  selectModel("test");
  let finish: (value: Response) => void;
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url, "/api/sessions/test/branches");
    assert.deepEqual(JSON.parse(String(options?.body)), { message_id: 42 });
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  };
  const pending = branchThread(42);
  assert.equal(useThread.getState().branchingMessageId, 42);
  assert.equal(await branchThread(42), null);
  finish!(json({ ...testSession, id: "fork", title: "原标题（2）", updated_at: 2 }));
  assert.equal(await pending, "fork");
  assert.equal(requests, 1);
  assert.equal(useThread.getState().branchingMessageId, 0);
  assert.equal(useThread.getState().currentId, "test");
  assert.deepEqual(useThread.getState().messages, [row]);
  assert.equal(useThread.getState().threads[0].title, "原标题（2）");
});

test("分支失败保留原会话；请求期间用户开始新回复或切换会话，不被延迟分支结果抢走", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  useThread.setState({
    currentId: "test",
    busy: false,
    branchingMessageId: 0,
    threads: [testSession],
  });
  selectModel("test");
  globalThis.fetch = async () => json({ error: "创建失败" }, 500);
  assert.equal(await branchThread(42), null);
  assert.equal(useThread.getState().currentId, "test");
  assert.equal(useThread.getState().branchingMessageId, 0);
  let finish: (value: Response) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      finish = resolve;
    });
  const pending = branchThread(42);
  useThread.setState((state) => ({ busy: true, viewSeq: state.viewSeq + 1 }));
  finish!(json({ ...testSession, id: "fork-late" }));
  assert.equal(await pending, null);
  assert.equal(useThread.getState().currentId, "test");
  assert.equal(useThread.getState().busy, true);
  useThread.setState({ busy: false });
  const switching = branchThread(42);
  useThread.setState((state) => ({ currentId: "other", generation: state.generation + 1 }));
  finish!(json({ ...testSession, id: "fork-other" }));
  assert.equal(await switching, null);
  assert.equal(useThread.getState().currentId, "other");
  assert.ok(useThread.getState().threads.some((session) => session.id === "fork-other"));
});

function eventStream(
  signal: AbortSignal,
  start: (emit: (frame: GlobalFrame) => void, close: () => void) => void,
) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (frame: GlobalFrame) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        signal.addEventListener(
          "abort",
          () => controller.error(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        start(emit, () => controller.close());
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("多个对话发送、切换与停止复用唯一全局 SSE，done 不关闭全局连接", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const a = { ...testSession, id: "global-a" };
  const b = { ...testSession, id: "global-b" };
  const sessions = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const users = new Map<string, RawMessage>();
  const requests: string[] = [];
  let emit: (frame: GlobalFrame) => void;
  let connectionSignal: AbortSignal;
  const publish = (id: string, event: StreamEvent) =>
    emit({ epoch: "test", cursor: ++cursor, session_id: id, run_id: id, event });
  globalThis.fetch = async (route, options) => {
    requests.push(`${options?.method || "GET"} ${route}`);
    if (String(route) === "/api/events") {
      connectionSignal = options!.signal as AbortSignal;
      return eventStream(connectionSignal, (send) => {
        emit = send;
        send({ epoch: "test", cursor, snapshot: { sessions: [a, b] } });
      });
    }
    const id = String(route).split("/")[3];
    if (options?.method !== "POST") {
      assert.ok(String(route).includes("/messages?limit="));
      return json(page(users.has(id) ? [users.get(id)!] : [], sessions.get(id)!));
    }
    if (String(route).endsWith("/cancel")) {
      sessions.set(id, { ...sessions.get(id)!, running: false });
      publish(id, { type: "done", status: "aborted", session: sessions.get(id)! });
      return json({ ok: true });
    }
    assert.ok(String(route).endsWith("/messages"));
    const item = {
      type: "message" as const,
      role: "user" as const,
      content: [{ type: "input_text" as const, text: id }],
    };
    const row: RawMessage = { id: users.size + 1, item, created_at: 1 };
    users.set(id, row);
    sessions.set(id, { ...sessions.get(id)!, running: true });
    publish(id, {
      type: "message",
      item,
      sequence: 0,
      created_at: 1,
      saved: [{ sequence: 0, id: row.id, meta: null, usage: null, created_at: 1 }],
      session: sessions.get(id)!,
    });
    publish(id, { type: "message", delta: `${id} 生成中` });
    return json(
      { epoch: "test", cursor, run_id: id, message: row, session: sessions.get(id) },
      202,
    );
  };
  const opening = startEvents();
  assert.equal(startEvents(), opening);
  await opening;
  await openThread(a.id);
  selectModel("test");
  assert.equal(send("A"), true);
  await tick();
  await openThread(b.id);
  selectModel("test");
  assert.equal(send("B"), true);
  await tick();
  assert.equal(useThread.getState().threads.filter((thread) => thread.running).length, 2);
  const before = useThread.getState().messages;
  sessions.set(a.id, { ...a, running: false });
  publish(a.id, { type: "done", status: "completed", session: sessions.get(a.id)! });
  await tick();
  assert.equal(useThread.getState().currentId, b.id);
  assert.equal(useThread.getState().busy, true);
  assert.equal(useThread.getState().messages, before);
  assert.equal(useThread.getState().threads.find((thread) => thread.id === a.id)?.running, false);
  await stopRun();
  await tick();
  assert.equal(useThread.getState().busy, false);
  assert.equal(useThread.getState().notes[0].code, "stopped");
  assert.equal(connectionSignal!.aborted, false);
  assert.equal(requests.filter((request) => request === "GET /api/events").length, 1);
  assert.equal(
    requests.filter((request) => request.startsWith("POST") && request.endsWith("/messages"))
      .length,
    2,
  );
  assert.equal(
    requests.filter(
      (request) =>
        request.includes("/global-a/events") ||
        request.includes("/global-b/events") ||
        request === "GET /api/sessions",
    ).length,
    0,
  );
});

test("历史查询期间按游标接续片段和提交，边界两侧不重放、不漏算、不回退运行状态", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const session = { ...testSession, id: "history-race", running: true };
  const user: RawMessage = {
    id: 21,
    item: { type: "message", role: "user", content: [{ type: "input_text", text: "问" }] },
    created_at: 1,
  };
  let resolve: (value: Response) => void;
  const pending = new Promise<Response>((done) => {
    resolve = done;
  });
  globalThis.fetch = async () => pending;
  const opening = openThread(session.id);
  pushEvent(
    {
      type: "message",
      item: user.item as any,
      sequence: 0,
      created_at: 1,
      saved: [{ sequence: 0, id: user.id, meta: null, usage: null, created_at: 1 }],
      session,
    },
    session.id,
  );
  pushEvent({ type: "message", delta: "A" }, session.id);
  const boundary = cursor;
  pushEvent({ type: "message", delta: "B" }, session.id);
  const item = {
    type: "message" as const,
    role: "assistant" as const,
    content: [{ type: "output_text" as const, text: "AB" }],
  };
  pushEvent({ type: "message", item, sequence: 1, created_at: 2 }, session.id);
  const complete = {
    ...session,
    running: false,
    request_count: 1,
    cost: { amount: 0.25, currency: "USD", unpriced_requests: 0 },
  };
  pushEvent(
    {
      type: "usage",
      usage: { total_tokens: 5 },
      metering: null,
      saved: [{ sequence: 1, id: 22, meta: null, usage: { total_tokens: 5 }, created_at: 2 }],
      session: { ...complete, running: true },
    },
    session.id,
  );
  pushEvent({ type: "done", status: "completed", session: complete }, session.id);
  resolve!(
    json(
      page([user], session, {
        cursor: boundary,
        run_id: "test-run",
        pending: [{ type: "message", delta: "A" }],
      }),
    ),
  );
  await opening;
  assert.deepEqual(
    useThread.getState().messages.map((row) => row.id),
    [21, 22],
  );
  assert.equal(
    buildRows(useThread.getState().messages).find((row) => row.kind === "assistant")?.content,
    "AB",
  );
  assert.equal(useThread.getState().busy, false);
  assert.equal(useThread.getState().threads[0].running, false);
  assert.equal(useThread.getState().threads[0].cost.amount, 0.25);
  // 重复或过期全局事件不能改写已完成的结果。
  receiveFrame({
    epoch: "test",
    cursor: boundary,
    session_id: session.id,
    run_id: "test-run",
    event: { type: "message", delta: "重复" },
  });
  assert.equal(useThread.getState().messages.length, 2);
});

test("全局流自动重连，重新读取快照恢复同一任务，模型请求保持一次", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const session = { ...testSession, id: "reconnect", running: true };
  const user: RawMessage = {
    id: 7,
    item: { type: "message", role: "user", content: [{ type: "input_text", text: "工作" }] },
  };
  let connections = 0;
  let close: () => void;
  let historyReads = 0;
  let posts = 0;
  globalThis.fetch = async (route, options) => {
    if (String(route) === "/api/events") {
      connections++;
      return eventStream(options!.signal as AbortSignal, (emit, end) => {
        close = end;
        emit({ epoch: "test", cursor, snapshot: { sessions: [session] } });
      });
    }
    if (options?.method === "POST") {
      posts++;
      return json({ epoch: "test", cursor, run_id: "running", message: user, session }, 202);
    }
    historyReads++;
    return json(
      page([user], session, {
        run_id: "running",
        pending: [{ type: "message", delta: "已恢复片段" }],
      }),
    );
  };
  await startEvents();
  await openThread(session.id);
  assert.equal(useThread.getState().busy, true);
  close!();
  await tick();
  assert.equal(useThread.getState().connected, false);
  assert.equal(send("断线时不重发"), false);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(connections, 2);
  assert.equal(historyReads, 2);
  assert.equal(posts, 0);
  assert.equal(useThread.getState().connected, true);
  assert.equal(useThread.getState().busy, true);
  assert.match(JSON.stringify(useThread.getState().messages), /已恢复片段/);
});

test("HTTP 确认晚于 SSE 完成时不回退状态，发送过程中换页不抢走当前对话", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const a = { ...testSession, id: "late-ack" };
  const b = { ...testSession, id: "current" };
  let accept: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    accept = resolve;
  });
  globalThis.fetch = async (_route, options) =>
    options?.method === "POST" ? pending : json(page([], b));
  useThread.setState({ currentId: a.id, threads: [a, b] });
  selectModel("test");
  assert.equal(send("问题"), true);
  await openThread(b.id);
  pushEvent({ type: "done", status: "completed", session: a }, a.id, "run-a");
  accept!(
    json(
      {
        epoch: "test",
        cursor: 0,
        run_id: "run-a",
        message: { id: 4, item: { type: "message", role: "user", content: [] } },
        session: { ...a, running: true },
      },
      202,
    ),
  );
  await tick();
  assert.equal(useThread.getState().currentId, b.id);
  assert.equal(useThread.getState().threads.find((thread) => thread.id === a.id)?.running, false);
  assert.equal(useThread.getState().busy, false);
});

test("生成过程中也能加载更早消息，分页期间实时输出和运行状态保持更新", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const session = { ...testSession, id: "older-while-running", running: true };
  const current: RawMessage = {
    id: 61,
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "正在处理的问题" }],
    },
  };
  let finish: (response: Response) => void;
  const result = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return result;
  };
  useThread.setState({
    currentId: session.id,
    ready: true,
    busy: true,
    hasMore: true,
    messages: [current],
    threads: [session],
  });
  selectModel("test");
  const loading = loadOlder();
  void loadOlder();
  assert.deepEqual(requests, [`/api/sessions/${session.id}/messages?limit=60&before=61`]);
  assert.equal(useThread.getState().loadingOlder, true);
  pushEvent({ type: "message", delta: "新的实时输出" }, session.id);
  const latest = {
    ...session,
    request_count: 4,
    cost: { amount: 0.6, currency: "USD", unpriced_requests: 0 },
  };
  pushEvent({ type: "usage", usage: null, metering: null, session: latest }, session.id);
  finish!(
    json(page([call, output], { ...session, running: false }, { has_more: true, cursor: 0 })),
  );
  await loading;
  assert.deepEqual(
    useThread
      .getState()
      .messages.filter((row) => row.id > 0)
      .map((row) => row.id),
    [1, 2, 61],
  );
  assert.match(JSON.stringify(useThread.getState().messages), /新的实时输出/);
  assert.equal(useThread.getState().busy, true);
  assert.equal(useThread.getState().threads[0].running, true);
  assert.equal(useThread.getState().threads[0].cost.amount, 0.6);
  assert.equal(useThread.getState().loadingOlder, false);
});

test("历史分页使用已保存消息的边界，失败可重试，切换后不混入上一对话", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const stored = { ...output, id: 70 };
  const temporary = { ...call, id: 0, streaming: true };
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return json({ error: "暂时失败" }, 500);
  };
  useThread.setState({
    currentId: "old-history",
    ready: true,
    busy: false,
    hasMore: true,
    messages: [temporary, stored],
  });
  selectModel("test");
  await loadOlder();
  assert.equal(requests[0], "/api/sessions/old-history/messages?limit=60&before=70");
  assert.equal(useThread.getState().loadingOlder, false);
  assert.equal(useThread.getState().hasMore, true);
  let finish: (response: Response) => void;
  const result = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  globalThis.fetch = async (url) =>
    String(url).includes("before=")
      ? result
      : json(page([], { ...testSession, id: "new-history" }));
  const loading = loadOlder();
  await openThread("new-history");
  finish!(json(page([call])));
  await loading;
  assert.equal(useThread.getState().currentId, "new-history");
  assert.deepEqual(useThread.getState().messages, []);
  assert.equal(useThread.getState().loadingOlder, false);
});

test("普通附件可以单独发送，失败保留原文件重试，确认后只保留下载元数据", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const file = {
    name: "说明.txt",
    type: "text/plain",
    size: 3,
    data: "data:text/plain;base64,YWJj",
  };
  const stored = {
    name: file.name,
    type: file.type,
    size: file.size,
    url: "/api/attachments/test-file",
    path: "/server/attachments/test-file/说明.txt",
  };
  useThread.setState({ currentId: "file-message", messages: [], ready: true, busy: false });
  selectModel("test");
  let requests = 0;
  globalThis.fetch = async (_route, options) => {
    requests++;
    assert.deepEqual(JSON.parse(String(options?.body)), {
      text: "",
      images: [],
      attachments: [{ name: file.name, data: file.data }],
      model_id: "test",
      compact_model_id: "test",
    });
    if (requests === 1) {
      return json({ error: "发送失败" }, 500);
    }
    return acceptEvents([
      {
        type: "message",
        item: { type: "message", role: "user", content: [] },
        meta: { attachments: [stored] },
        sequence: 0,
        created_at: 1,
        saved: [
          { sequence: 0, id: 80, meta: { attachments: [stored] }, usage: null, created_at: 1 },
        ],
      },
      { type: "done", status: "completed" },
    ]);
  };
  assert.equal(send("", null, undefined, [], Array(6).fill(file)), false);
  assert.equal(requests, 0);
  assert.equal(send("", null, undefined, [], [file]), true);
  await tick();
  const failed = buildRows(useThread.getState().messages)[0];
  assert.equal(failed.failed, true);
  assert.deepEqual(failed.uploads, [file]);
  assert.equal(failed.attachments?.[0].name, file.name);
  assert.equal(retrySend(failed), true);
  await tick();
  const record = useThread.getState().messages[0];
  assert.equal(record.id, 80);
  assert.equal(record.uploads, undefined);
  assert.deepEqual(buildRows([record])[0].attachments, [stored]);
  assert.equal(buildRows([record])[0].content, "");
  assert.equal(JSON.stringify(record).includes("base64"), false);
  assert.equal(useThread.getState().busy, false);
});

test("附件选择统一检查图片、文件数量与大小，原始文件类型不影响通用附件入口", () => {
  const ordinary = { type: "application/pdf", size: 25 * 1024 * 1024 };
  const image = { type: "image/png", size: 10 * 1024 * 1024 };
  assert.equal(isImageAttachment(image), true);
  assert.equal(isImageAttachment(ordinary), false);
  assert.equal(validateAttachments([ordinary, ordinary]), "");
  assert.match(validateAttachments([ordinary, ordinary, image]), /总计/);
  assert.match(validateAttachments([{ ...ordinary, size: ordinary.size + 1 }]), /25 MiB/);
  assert.match(validateAttachments([{ ...image, size: image.size + 1 }]), /10 MiB/);
  assert.match(validateAttachments(Array(6).fill({ type: "text/plain", size: 1 })), /5 个/);
  assert.match(validateAttachments([{ type: "text/plain", size: 0 }]), /不能为空/);
});

test("模型选择记住最近使用的模型，旧对话以自己最近发送的为准，随请求固定", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const initial = useThread.getState().status!;
  const models = [
    {
      id: "a",
      name: "模型一",
      model: "fable",
      protocol: "anthropic-messages" as const,
      context_window: 0,
    },
    {
      id: "b",
      name: "模型二",
      model: "deepseek",
      protocol: "chat-completions" as const,
      context_window: 0,
    },
  ];
  useThread.setState({
    status: { ...initial, models },
    modelChoices: {},
    currentId: "one",
    messages: [],
  });
  // 从未选择过时取列表第一个；选过之后，新对话沿用最近使用的模型。
  assert.equal(selectedModel()?.id, "a");
  selectModel("b");
  assert.equal(selectedModel()?.id, "b");
  useThread.setState({ currentId: "two", messages: [] });
  assert.equal(selectedModel()?.id, "b");
  // 已发过消息的对话以自己最近一次发送的模型为准，不被最近使用的模型覆盖。
  useThread.setState({
    currentId: "three",
    messages: [
      {
        id: 7,
        item: { type: "message", role: "user", content: [] },
        meta: { model_id: "a", compact_model_id: "a" },
      },
    ],
  });
  assert.equal(selectedModel()?.id, "a");
  useThread.setState({ currentId: "one", messages: [] });
  let sent: Record<string, string> = {};
  globalThis.fetch = async (_route, options) => {
    sent = JSON.parse(String(options?.body));
    return acceptEvents([{ type: "done", status: "completed" }]);
  };
  assert.equal(send("问题"), true);
  selectModel("a");
  await tick();
  // 请求发出后再改选择不影响已发送的请求；压缩模型固定使用对话模型。
  assert.equal(sent.model_id, "b");
  assert.equal(sent.compact_model_id, "b");
  useThread.setState({
    modelChoices: {},
    messages: [
      {
        id: 1,
        item: { type: "message", role: "user", content: [] },
        meta: { model_id: "b", compact_model_id: "b" },
      },
    ],
  });
  assert.equal(selectedModel()?.id, "b");
  useThread.setState({ status: { ...initial, models: [models[0]] } });
  assert.equal(selectedModel()?.id, "a");
});

test("置顶顺序运算：拖入、组内排序、拖出，插入下标不含被拖会话", () => {
  const pinned = ["a", "b", "c"];
  assert.deepEqual(nextPinnedIds(pinned, "d", { kind: "pinned", index: 1 }), ["a", "d", "b", "c"]);
  assert.deepEqual(nextPinnedIds(pinned, "a", { kind: "pinned", index: 2 }), ["b", "c", "a"]);
  assert.deepEqual(nextPinnedIds(pinned, "c", { kind: "pinned", index: 0 }), ["c", "a", "b"]);
  assert.deepEqual(nextPinnedIds(pinned, "b", { kind: "recent" }), ["a", "c"]);
  assert.deepEqual(nextPinnedIds([], "x", { kind: "pinned", index: 0 }), ["x"]);
  assert.deepEqual(nextPinnedIds(["a"], "x", { kind: "pinned", index: 99 }), ["a", "x"]);
  assert.deepEqual(nextPinnedIds(["a"], "x", { kind: "pinned", index: -3 }), ["x", "a"]);
  // 拖回原位、把未置顶的拖到其余区域，结果不变，调用方据此跳过请求。
  assert.equal(
    samePinnedIds(nextPinnedIds(pinned, "b", { kind: "pinned", index: 1 }), pinned),
    true,
  );
  assert.equal(samePinnedIds(nextPinnedIds(pinned, "z", { kind: "recent" }), pinned), true);
  assert.equal(samePinnedIds(["a", "b"], ["b", "a"]), false);
});

test("列表排序置顶在前且按序号升序，其余按最近活动，序号 0 也算置顶", () => {
  const thread = (id: string, pinned: number | null, updated_at: number) => ({
    ...testSession,
    id,
    pinned,
    updated_at,
  });
  const sorted = [
    thread("x", null, 5),
    thread("p2", 1, 1),
    thread("y", null, 9),
    thread("p1", 0, 2),
  ];
  sorted.sort(compareThreads);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["p1", "p2", "y", "x"],
  );
  assert.equal(isPinned(thread("z", 0, 1)), true);
  assert.equal(isPinned(thread("z", null, 1)), false);
});

test("单个置顶使用服务端返回的序号并排到最前；失败只提示不改列表", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const a = { ...testSession, id: "a", updated_at: 2 };
  const b = { ...testSession, id: "b", updated_at: 1 };
  useThread.setState({ threads: [a, b] });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/sessions/b");
    assert.equal(options?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(options?.body)), { pinned: true });
    return json({ ...b, pinned: -1 });
  };
  await pinThread("b", true);
  assert.deepEqual(
    useThread.getState().threads.map((item) => [item.id, item.pinned]),
    [
      ["b", -1],
      ["a", null],
    ],
  );
  globalThis.fetch = async () => json({ error: "会话不存在" }, 404);
  await pinThread("a", true);
  assert.deepEqual(
    useThread.getState().threads.map((item) => [item.id, item.pinned]),
    [
      ["b", -1],
      ["a", null],
    ],
  );
});

test("拖拽排序先乐观更新，以服务端确认为准；失败时回滚到拖拽之前", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const thread = (id: string, pinned: number | null, updated_at: number) => ({
    ...testSession,
    id,
    pinned,
    updated_at,
  });
  const initial = [
    thread("a", 0, 1),
    thread("b", 1, 2),
    thread("c", null, 9),
    thread("d", null, 5),
  ];
  const order = () => useThread.getState().threads.map((item) => [item.id, item.pinned]);
  useThread.setState({ threads: initial });

  let finish: (value: Response) => void;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/sessions/pinned");
    assert.equal(options?.method, "PUT");
    assert.deepEqual(JSON.parse(String(options?.body)), { ids: ["c", "a"] });
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  };
  // 把 c 拖入最前，b 被挤出置顶。
  const pending = setPinnedThreads(["c", "a"]);
  assert.deepEqual(order(), [
    ["c", 0],
    ["a", 1],
    ["d", null],
    ["b", null],
  ]);
  finish!(
    json({
      sessions: [thread("c", 0, 9), thread("a", 1, 1), thread("d", null, 5), thread("b", null, 2)],
    }),
  );
  await pending;
  assert.deepEqual(order(), [
    ["c", 0],
    ["a", 1],
    ["d", null],
    ["b", null],
  ]);

  // 失败：回到拖拽之前的状态。
  useThread.setState({ threads: initial });
  globalThis.fetch = async () => json({ error: "服务暂时不可用" }, 500);
  await setPinnedThreads(["c"]);
  assert.deepEqual(order(), [
    ["a", 0],
    ["b", 1],
    ["c", null],
    ["d", null],
  ]);
});
