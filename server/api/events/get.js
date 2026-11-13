import { readSessions } from "../sessions/get.js";

export default function get(req, res, context) {
  // 快照和订阅之间不 await，客户端可按 epoch/cursor 对齐并发历史查询。
  const sessions = readSessions(context);
  const emit = context.events.subscribe(res);
  emit({
    epoch: context.events.epoch,
    cursor: context.events.cursor,
    snapshot: { sessions },
  });
}
