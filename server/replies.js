import { randomUUID } from "node:crypto";

// 已提交的历史归数据库，内存只保留当前未提交轮次和最后一次终止结果。
// 执行不持有 HTTP 连接；输出交给全局广播。
export function createReply(publish) {
  let finish;
  const reply = {
    id: randomUUID(),
    controller: new AbortController(),
    running: true,
    pending: [],
    error: null,
    terminal: null,
    done: new Promise((resolve) => {
      finish = resolve;
    }),
    publish(event) {
      if (event.saved) {
        reply.pending = [];
      } else if (event.type === "error") {
        reply.error = event;
      } else if (event.type === "done") {
        reply.terminal = event;
        reply.pending = [];
      } else if (
        ["message", "reasoning", "function_call", "function_call_output"].includes(event.type)
      ) {
        const previous = reply.pending.at(-1);
        if (event.delta && previous?.delta && previous.type === event.type) {
          // 合并连续 delta，重连不需要逐字重放已收到的网络分片。
          reply.pending[reply.pending.length - 1] = {
            ...previous,
            delta: previous.delta + event.delta,
          };
        } else {
          reply.pending.push(event);
        }
      }
      publish(reply.id, event);
    },
    finish() {
      reply.running = false;
      reply.pending = [];
      finish();
    },
  };
  return reply;
}
