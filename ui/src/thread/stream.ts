import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Thread } from "./store";
import type {
  MessageItem,
  ReasoningItem,
  FunctionCallItem,
  FunctionOutputItem,
  Compaction,
  Metering,
  MessageMeta,
} from "./thread";

interface SavedMessage {
  sequence: number;
  id: number;
  meta: MessageMeta | null;
  usage: Record<string, unknown> | null;
  metering?: Metering | null;
  created_at: number;
}

// API 在原有九种事件外补充保存信息；标准 item 不加业务字段。
export type StreamEvent = (
  | { type: "message"; delta: string; item?: never }
  | { type: "message"; item: MessageItem; delta?: never; sequence: number; created_at: number }
  | { type: "reasoning"; delta: string; item?: never }
  | { type: "reasoning"; item: ReasoningItem; delta?: never; sequence: number; created_at: number }
  | { type: "function_call"; item: FunctionCallItem; sequence: number; created_at: number }
  | { type: "function_call_output"; item: FunctionOutputItem; sequence: number; created_at: number }
  | { type: "retry"; attempt: number; maxRetries: number; delayMs: number; error: string }
  | { type: "usage"; usage: Record<string, unknown> | null; metering: Metering | null }
  | { type: "compact"; status: "started" }
  | {
      type: "compact";
      status: "completed";
      compaction: Compaction;
      item: MessageItem;
      start: number;
      end: number;
      usage: Record<string, unknown> | null;
      metering: Metering | null;
    }
  | { type: "done"; status: "completed" | "incomplete" | "aborted"; stopReason?: string }
  | { type: "error"; code: string; error: string }
) & {
  meta?: MessageMeta | null;
  saved?: SavedMessage[];
  session?: Thread;
};

export type ReplyFrame = {
  epoch: string;
  cursor: number;
  session_id: string;
  run_id: string;
  event: StreamEvent;
};
export type GlobalFrame =
  | ReplyFrame
  | ({ epoch: string; cursor: number } & (
      | { snapshot: { sessions: Thread[] } }
      | { session: Thread }
      | { deleted_session_id: string }
    ));

// 页面生命周期只有这一条 SSE，发送消息与停止均使用普通 HTTP。
export async function connectEvents(signal: AbortSignal, receive: (frame: GlobalFrame) => void) {
  const response = await fetch("/api/events", { signal });
  if (!response.ok) {
    if (response.status === 401) {
      useAuth.setState({ state: "out" });
    }
    const detail = await response.json();
    throw new ApiError(detail.error || `HTTP ${response.status}`, response.status);
  }
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error("服务器没有返回事件流");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
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
          receive(JSON.parse(data) as GlobalFrame);
        }
        split = buffer.indexOf("\n\n");
      }
      if (done) {
        throw new Error("事件连接已断开");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
