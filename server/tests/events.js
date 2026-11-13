import { selectedInput } from "./config-fixture.js";
import assert from "node:assert/strict";

// 测试同样通过一条全局流观察普通 HTTP 发起的任务。
export async function connectEvents(request) {
  const response = await request("/api/events");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const reader = response.body.getReader();
  const frames = [];
  const waiters = new Set();
  let ended = false;
  const reading = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let split = buffer.indexOf("\n\n");
        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (data) {
            const frame = JSON.parse(data);
            frames.push(frame);
            for (const waiter of waiters) {
              if (waiter.predicate(frame)) {
                waiter.resolve(frame);
              }
            }
          }
          split = buffer.indexOf("\n\n");
        }
        if (done) {
          break;
        }
      }
    } finally {
      ended = true;
      for (const waiter of waiters) {
        waiter.reject(new Error("事件连接已结束"));
      }
    }
  })().catch(() => {});
  function waitFor(predicate) {
    const found = frames.find(predicate);
    if (found) {
      return Promise.resolve(found);
    }
    if (ended) {
      return Promise.reject(new Error("事件连接已结束"));
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve(value) {
          clearTimeout(timer);
          waiters.delete(waiter);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          waiters.delete(waiter);
          reject(error);
        },
      };
      const timer = setTimeout(() => waiter.reject(new Error("等待事件超时")), 7000);
      waiters.add(waiter);
    });
  }
  await waitFor((frame) => Boolean(frame.snapshot));
  return {
    frames,
    waitFor,
    async close() {
      await reader.cancel().catch(() => {});
      await reading;
    },
  };
}

export async function startReply(request, route, data, stream) {
  const ownStream = !stream;
  const subscription = stream || (await connectEvents(request));
  const response = await request(route, "POST", selectedInput(data));
  assert.equal(response.status, 202);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  const accepted = await response.json();
  const events = subscription
    .waitFor((frame) => frame.run_id === accepted.run_id && frame.event?.type === "done")
    .then(async () => {
      const list = subscription.frames
        .filter((frame) => frame.run_id === accepted.run_id)
        .map((frame) => frame.event);
      if (ownStream) {
        await subscription.close();
      }
      return list;
    });
  return { accepted, events, subscription };
}

export async function runReply(request, route, data) {
  return (await startReply(request, route, data)).events;
}
