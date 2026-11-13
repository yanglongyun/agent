import test from "node:test";
import assert from "node:assert/strict";
import openDB from "../db.js";
import { createSession, createRunRecorder, forkContext } from "../session.js";
import { message } from "../ai/index.js";
import { createTaskManager } from "../tasks.js";

function fixture(t) {
  const db = openDB(":memory:");
  t.after(() => db.close());
  const session = createSession(db);
  db.prepare(
    "INSERT INTO tasks (id, session_id, parent_task_id, status) VALUES (?, ?, ?, 'completed')",
  ).run("parent", session.id, null);
  db.prepare(
    "INSERT INTO tasks (id, session_id, parent_task_id, status) VALUES (?, ?, ?, 'completed')",
  ).run("child", session.id, "parent");
  return { db, session };
}
function measurement(amount) {
  return {
    status: amount === null ? "unpriced" : "priced",
    cost: amount === null ? null : { amount, currency: "USD" },
  };
}
function response(recorder, amount) {
  recorder.track({ type: "message", item: message("回答", "output_text", "assistant") });
  return recorder.track({
    type: "usage",
    usage: { total_tokens: 10 },
    metering: measurement(amount),
  });
}
function compact(recorder, amount) {
  return recorder.track({
    type: "compact",
    status: "completed",
    start: 0,
    end: 1,
    item: message("摘要"),
    usage: { total_tokens: 10 },
    metering: measurement(amount),
  });
}

test("会话累计主请求、各层子任务和压缩；任务只累计自身，分叉和重复确认不重复计费", (t) => {
  const { db, session } = fixture(t);
  const root = createRunRecorder(db, { sessionId: session.id }, [], "");
  const parent = createRunRecorder(db, { taskId: "parent" }, [], "");
  const child = createRunRecorder(db, { taskId: "child" }, [], "");
  response(root, 0.1);
  root.track({ type: "usage", usage: { total_tokens: 10 }, metering: measurement(0.1) });
  response(root, 0.01);
  response(parent, 0.2);
  response(child, 0.3);
  response(child, null);
  const committed = compact(root, 0.05);
  compact(parent, 0.04);
  assert.equal(committed.session.cost.amount, 0.66);
  assert.equal(committed.session.request_count, 6);
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT total_cost_nanos, unpriced_requests, request_count FROM sessions WHERE id = ?",
        )
        .get(session.id),
    },
    { total_cost_nanos: 700000000, unpriced_requests: 1, request_count: 7 },
  );
  const manager = createTaskManager(db, {});
  const scope = { sessionId: session.id };
  assert.deepEqual(manager.info("parent", scope).cost, {
    amount: 0.24,
    currency: "USD",
    unpriced_requests: 0,
  });
  assert.equal(manager.info("parent", scope).request_count, 2);
  assert.deepEqual(manager.info("child", scope).cost, {
    amount: 0.3,
    currency: "USD",
    unpriced_requests: 1,
  });
  forkContext(db, { sessionId: session.id }, { taskId: "child" });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM metering").get().n, 7);
  assert.equal(
    db.prepare("SELECT total_cost_nanos FROM sessions WHERE id = ?").get(session.id)
      .total_cost_nanos,
    700000000,
  );
});

test("累计金额写入失败时，消息、计量、任务和会话一起回滚；重试只入账一次", (t) => {
  const { db, session } = fixture(t);
  const recorder = createRunRecorder(db, { taskId: "child" }, [], "");
  db.exec(
    "CREATE TRIGGER reject_total BEFORE UPDATE OF total_cost_nanos ON sessions BEGIN SELECT RAISE(ABORT, 'total failed'); END",
  );
  assert.throws(() => response(recorder, 0.000000001), /total failed/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM metering").get().n, 0);
  assert.equal(
    db.prepare("SELECT request_count FROM tasks WHERE id = 'child'").get().request_count,
    0,
  );
  assert.equal(
    db.prepare("SELECT request_count FROM sessions WHERE id = ?").get(session.id).request_count,
    0,
  );
  db.exec("DROP TRIGGER reject_total");
  recorder.track({
    type: "usage",
    usage: { total_tokens: 10 },
    metering: measurement(0.000000001),
  });
  assert.equal(
    db.prepare("SELECT total_cost_nanos FROM tasks WHERE id = 'child'").get().total_cost_nanos,
    1,
  );
  assert.equal(
    db.prepare("SELECT total_cost_nanos FROM sessions WHERE id = ?").get(session.id)
      .total_cost_nanos,
    1,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM metering").get().n, 1);
});

test("压缩费用与摘要和计量明细一起回滚，重新提交后累计正确", (t) => {
  const { db, session } = fixture(t);
  const recorder = createRunRecorder(db, { sessionId: session.id }, [], "");
  response(recorder, 0.1);
  db.exec(
    "CREATE TRIGGER reject_total BEFORE UPDATE OF total_cost_nanos ON sessions BEGIN SELECT RAISE(ABORT, 'total failed'); END",
  );
  assert.throws(() => compact(recorder, 0.02), /total failed/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compactions").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM metering").get().n, 1);
  assert.equal(
    db.prepare("SELECT total_cost_nanos FROM sessions WHERE id = ?").get(session.id)
      .total_cost_nanos,
    100000000,
  );
  db.exec("DROP TRIGGER reject_total");
  const committed = compact(recorder, 0.02);
  assert.equal(committed.session.cost.amount, 0.12);
  assert.equal(committed.session.request_count, 2);
});
