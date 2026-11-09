import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Thread } from "./store";
import type {
  MessageItem,
  ReasoningItem,
  FunctionCallItem,
  FunctionOutputItem,
  Compaction,
} from "./thread";

interface SavedMessage {
  sequence: number;
  id: number;
  usage: Record<string, unknown> | null;
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
  | { type: "usage"; usage: Record<string, unknown> | null }
  | { type: "compact"; status: "started" }
  | {
      type: "compact";
      status: "completed";
      compaction: Compaction;
      item: MessageItem;
      start: number;
      end: number;
      usage: Record<string, unknown> | null;
    }
  | { type: "done"; status: "completed" | "incomplete" | "aborted"; stopReason?: string }
  | { type: "error"; code: string; error: string }
) & {
  saved?: SavedMessage[];
  session?: Thread;
};

// 一个 POST 对应一次回复，连接关闭会停止服务端执行。
export async function streamMessage(
  id: string,
  text: string,
  signal: AbortSignal,
  receive: (event: StreamEvent) => void,
  images: string[] = [],
) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, images }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 401) {
      useAuth.setState({ state: "out" });
    }
    const detail = await response.json();
    throw new ApiError(detail.error || `HTTP ${response.status}`, response.status);
  }
  if (!response.body) {
    throw new Error("服务器没有返回事件流");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) {
          continue;
        }
        const event = JSON.parse(data) as StreamEvent;
        if (event.type === "done") {
          completed = true;
        }
        receive(event);
      }
      if (done) {
        break;
      }
    }
    if (!completed) {
      throw new Error("连接中断，本次回复未完成");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
