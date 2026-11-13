import { randomUUID } from "node:crypto";
import { stream } from "./api/http.js";

// 每个页面一个订阅，所有会话共用同一有序事件流。重连通过快照恢复，无历史日志。
export function createEvents() {
  const subscribers = new Map();
  const events = {
    epoch: randomUUID(),
    cursor: 0,
    subscribe(res) {
      const emit = stream(res);
      subscribers.set(res, emit);
      res.once("close", () => subscribers.delete(res));
      return emit;
    },
    publish(frame) {
      events.cursor++;
      const outgoing = { ...frame, epoch: events.epoch, cursor: events.cursor };
      for (const emit of subscribers.values()) {
        emit(outgoing);
      }
    },
    close() {
      for (const res of subscribers.keys()) {
        res.end();
      }
      subscribers.clear();
    },
  };
  return events;
}
