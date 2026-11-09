import { create } from "zustand";
import { api } from "../lib/api";
import { toast } from "../overlay/toast";
import { streamMessage } from "./stream";
import {
  mergeMessages,
  itemText,
  type RawMessage,
  type Row,
  type Compaction,
  type StoredItem,
  type MessageItem,
} from "./thread";

export interface Thread {
  id: string;
  title: string;
  preview: string;
  running: boolean;
  created_at: number;
  updated_at: number;
}
export interface Status {
  version: string;
  model: string;
  url: string;
  model_ready: boolean;
  workdir: string;
  data_dir: string;
}
interface Page {
  messages: RawMessage[];
  has_more: boolean;
}
interface ActiveReply {
  controller: AbortController;
  accepted: boolean;
  cancel?: Promise<unknown>;
}
interface ThreadState {
  threads: Thread[];
  currentId: string;
  status: Status | null;
  messages: RawMessage[];
  compactions: Compaction[];
  notes: Row[];
  expanded: Record<string, boolean>;
  busy: boolean;
  stopping: boolean;
  ready: boolean;
  loadError: string;
  viewSeq: number;
  generation: number;
  active: ActiveReply | null;
  hasMore: boolean;
  loadingOlder: boolean;
}
export const threadTitle = (thread: Thread | undefined) =>
  thread?.title || thread?.preview || "对话";
export const useThread = create<ThreadState>(() => ({
  threads: [],
  currentId: "",
  status: null,
  messages: [],
  compactions: [],
  notes: [],
  expanded: {},
  busy: false,
  stopping: false,
  ready: false,
  loadError: "",
  viewSeq: 0,
  generation: 0,
  active: null,
  hasMore: false,
  loadingOlder: false,
}));
const set = useThread.setState;
const get = useThread.getState;
const PAGE = 60;
const url = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
export function dispose() {
  get().active?.controller.abort();
  set((state) => ({
    generation: state.generation + 1,
    threads: state.threads.map((thread) =>
      thread.id === state.currentId ? { ...thread, running: false } : thread,
    ),
    active: null,
    busy: false,
    stopping: false,
    ready: false,
  }));
}
function reset() {
  dispose();
  set({
    messages: [],
    compactions: [],
    notes: [],
    expanded: {},
    busy: false,
    stopping: false,
    ready: false,
    loadError: "",
    hasMore: false,
    loadingOlder: false,
  });
}
export async function loadStatus() {
  try {
    const status = await api.get<Status>("/api/status");
    set({ status });
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "服务状态加载失败");
    return false;
  }
}
export async function loadThreads() {
  try {
    const data = await api.get<{ sessions: Thread[] }>("/api/sessions");
    set({ threads: data.sessions });
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "会话列表加载失败");
    return false;
  }
}
export async function init() {
  await Promise.all([loadStatus(), loadThreads()]);
}
async function loadHistory(id: string, version: number) {
  const [page, summaries] = await Promise.all([
    api.get<Page>(`${url(id)}/messages?limit=${PAGE}`),
    api.get<{ compactions: Compaction[] }>(`${url(id)}/compactions`),
  ]);
  if (get().generation !== version) {
    return;
  }
  set({ messages: page.messages, compactions: summaries.compactions, hasMore: page.has_more });
}
export async function openThread(id: string, force = false) {
  if (!id || (!force && get().currentId === id && (get().ready || get().busy))) {
    return;
  }
  reset();
  const version = get().generation;
  set({ currentId: id });
  try {
    await loadHistory(id, version);
    if (get().generation === version) {
      set((state) => ({ ready: true, viewSeq: state.viewSeq + 1 }));
    }
  } catch (error) {
    if (get().generation === version) {
      set({ loadError: error instanceof Error ? error.message : "对话打开失败" });
    }
  }
}
export function createDraft() {
  reset();
  set((state) => ({ currentId: "", ready: true, viewSeq: state.viewSeq + 1 }));
}
export async function loadOlder() {
  const { currentId, hasMore, loadingOlder, busy, generation, messages } = get();
  if (!currentId || !hasMore || loadingOlder || busy) {
    return;
  }
  set({ loadingOlder: true });
  try {
    const page = await api.get<Page>(
      `${url(currentId)}/messages?limit=${PAGE}&before=${messages[0].id}`,
    );
    if (get().generation !== generation) {
      return;
    }
    set((state) => ({
      messages: mergeMessages(page.messages, state.messages),
      hasMore: page.has_more,
    }));
  } catch (error) {
    if (get().generation === generation) {
      toast(error instanceof Error ? error.message : "历史消息加载失败");
    }
  } finally {
    if (get().generation === generation) {
      set({ loadingOlder: false });
    }
  }
}

// 同步完成发送检查并接管草稿；返回 true 后 Composer 才清空输入。
export function send(
  text: string,
  retryRow: Row | null = null,
  onCreated?: (id: string) => void,
  images: string[] = [],
): boolean {
  const content = text.trim();
  if ((!content && images.length === 0) || get().busy || !get().ready) {
    return false;
  }
  if (images.length > 5) {
    toast("每条消息最多发送 5 张图片");
    return false;
  }
  if (!get().status?.model_ready) {
    toast("请先确认服务连接并在设置中配置模型");
    return false;
  }
  const key = retryRow?.key || crypto.randomUUID();
  const item: MessageItem = { type: "message", role: "user", content: [] };
  if (content) {
    item.content.push({ type: "input_text", text: content });
  }
  for (const image of images) {
    item.content.push({ type: "input_image", image_url: image, detail: "auto" });
  }
  const user: RawMessage = {
    id: 0,
    key,
    item,
    created_at: Date.now(),
    sending: true,
    failed: false,
  };
  const running: ActiveReply = { controller: new AbortController(), accepted: false };
  set((state) => ({
    messages: [...state.messages.filter((message) => message.key !== key), user],
    notes: [],
    busy: true,
    stopping: false,
    active: running,
    viewSeq: state.viewSeq + 1,
  }));
  void receiveReply(content, key, running, get().generation, onCreated, images);
  return true;
}
async function receiveReply(
  content: string,
  userKey: string,
  running: ActiveReply,
  version: number,
  onCreated?: (id: string) => void,
  images: string[] = [],
) {
  const abort = running.controller;
  let id = get().currentId;
  let failure = "";
  let stopped = false;
  try {
    if (!id) {
      const session = await api.post<Thread>("/api/sessions");
      if (get().generation !== version) {
        return;
      }
      id = session.id;
      set((state) => ({ currentId: id, threads: [session, ...state.threads] }));
      onCreated?.(id);
    }
    await streamMessage(
      id,
      content,
      abort.signal,
      (event) => {
        if (get().generation !== version) {
          return;
        }
        switch (event.type) {
          case "message":
          case "reasoning":
          case "function_call":
          case "function_call_output": {
            if (event.item) {
              const item = event.item;
              if (item.type === "message" && item.role === "user") {
                running.accepted = true;
                set((state) => ({
                  messages: state.messages.map((entry) =>
                    entry.key === userKey
                      ? {
                          ...entry,
                          item,
                          sequence: event.sequence,
                          created_at: event.created_at,
                          sending: false,
                        }
                      : entry,
                  ),
                }));
                break;
              }
              set((state) => {
                const index = state.messages.findIndex(
                  (entry) => entry.streaming && entry.item.type === item.type,
                );
                if (index >= 0) {
                  return {
                    messages: state.messages.map((entry, position) =>
                      position === index
                        ? {
                            ...entry,
                            item,
                            sequence: event.sequence,
                            created_at: event.created_at,
                            streaming: false,
                          }
                        : entry,
                    ),
                  };
                }
                return {
                  messages: [
                    ...state.messages,
                    {
                      id: 0,
                      key: crypto.randomUUID(),
                      item,
                      sequence: event.sequence,
                      created_at: event.created_at,
                    },
                  ],
                };
              });
            } else if (event.type === "message" || event.type === "reasoning") {
              const delta = event.delta;
              set((state) => {
                const index = state.messages.findIndex(
                  (entry) => entry.streaming && entry.item.type === event.type,
                );
                let text = delta;
                if (index >= 0) {
                  const item = state.messages[index].item;
                  if (item.type === "message" || item.type === "reasoning") {
                    text = itemText(item) + delta;
                  }
                }
                let item: StoredItem;
                if (event.type === "message") {
                  item = {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text }],
                  };
                } else {
                  item = { type: "reasoning", summary: [{ type: "summary_text", text }] };
                }
                if (index >= 0) {
                  return {
                    messages: state.messages.map((entry, position) =>
                      position === index ? { ...entry, item } : entry,
                    ),
                  };
                }
                return {
                  messages: [
                    ...state.messages,
                    {
                      id: 0,
                      key: crypto.randomUUID(),
                      item,
                      streaming: true,
                      created_at: Date.now(),
                    },
                  ],
                };
              });
            }
            break;
          }
          case "compact":
            if (event.status === "started") {
              toast("正在压缩上下文…");
            } else {
              set((state) => ({ compactions: [...state.compactions, event.compaction] }));
            }
            break;
          case "retry":
            toast(
              `请求失败，${event.delayMs / 1000} 秒后重试（${event.attempt}/${event.maxRetries}）`,
            );
            break;
          case "error":
            failure = event.error;
            break;
          case "done":
            if (event.status === "incomplete" && !failure) {
              failure = event.stopReason || "回复未完成";
            }
            stopped = event.status === "aborted";
            break;
        }
        if (event.saved) {
          const saved = event.saved;
          set((state) => ({
            messages: state.messages.map((entry) => {
              if (entry.id > 0 || entry.sequence === undefined) {
                return entry;
              }
              const record = saved.find((row) => row.sequence === entry.sequence);
              if (!record) {
                return entry;
              }
              return {
                ...entry,
                id: record.id,
                usage: record.usage,
                created_at: record.created_at,
                sequence: undefined,
              };
            }),
          }));
        }
        if (event.session) {
          const session = event.session;
          set((state) => ({
            threads: [session, ...state.threads.filter((thread) => thread.id !== session.id)].sort(
              (a, b) => b.updated_at - a.updated_at,
            ),
          }));
        }
        if (get().stopping && running.accepted && !running.cancel) {
          void stopRun();
        }
      },
      images,
    );
  } catch (error) {
    if (!abort.signal.aborted) {
      failure = error instanceof Error ? error.message : "发送失败";
      if (running.accepted) {
        failure += "；请重新打开会话核对保存结果";
      }
    }
  } finally {
    await running.cancel;
    if (get().generation === version) {
      stopped = stopped || abort.signal.aborted;
      const notes: Row[] = [];
      if (failure) {
        notes.push({ key: crypto.randomUUID(), kind: "system", code: "error", content: failure });
      }
      if (stopped) {
        notes.push({ key: crypto.randomUUID(), kind: "system", code: "stopped" });
      }
      // 只保留确认已提交的记录。断流可能丢失确认，用户可重新打开核对。
      set((state) => ({
        messages: state.messages
          .filter((entry) => entry.id > 0 || (!running.accepted && entry.key === userKey))
          .map((entry) => {
            if (entry.key === userKey && !running.accepted) {
              return { ...entry, sending: false, failed: true };
            }
            return { ...entry, streaming: false };
          }),
        threads: state.threads.map((thread) =>
          thread.id === id ? { ...thread, running: false } : thread,
        ),
        notes,
        busy: false,
        stopping: false,
        active: null,
      }));
    }
  }
}
export const retrySend = (row: Row, onCreated?: (id: string) => void) =>
  row.failed ? send(row.content || "", row, onCreated, row.images) : false;
export async function stopRun() {
  const { currentId, busy, generation, active } = get();
  if (!busy || !active || active.cancel) {
    return;
  }
  set({ stopping: true });
  // 尚未收到用户消息确认时记住停止意图，确认到达后再发 cancel。
  if (!active.accepted) {
    return;
  }
  // 请求服务端停止，保留 SSE 以接收已提交消息的确认和最终 done。
  active.cancel = api.post(`${url(currentId)}/cancel`).catch((error) => {
    if (get().generation === generation) {
      active.cancel = undefined;
      set({ stopping: false });
      toast(error instanceof Error ? error.message : "停止失败");
    }
  });
  await active.cancel;
}
export async function renameThread(id: string, title: string) {
  try {
    await api.patch(url(id), { title });
    await loadThreads();
  } catch (error) {
    toast(error instanceof Error ? error.message : "重命名失败");
  }
}
export async function removeThread(id: string) {
  try {
    await api.del(url(id));
    if (get().currentId === id) {
      reset();
      set({ currentId: "" });
    }
    await loadThreads();
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败");
    return false;
  }
}
