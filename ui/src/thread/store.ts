import type { ModelInfo } from "../lib/models";
import { create } from "zustand";
import { api } from "../lib/api";
import { toast } from "../overlay/toast";
import { connectEvents, type GlobalFrame, type ReplyFrame, type StreamEvent } from "./stream";
import type { OwnerCost } from "./metering";
import type { UploadAttachment } from "./attachments";
import {
  mergeMessages,
  itemText,
  type RawMessage,
  type Row,
  type Compaction,
  type StoredItem,
  type MessageItem,
} from "./thread";

export interface Thread extends OwnerCost {
  id: string;
  title: string;
  preview: string;
  running: boolean;
  pinned: number | null;
  created_at: number;
  updated_at: number;
}
export interface Status {
  version: string;
  models: ModelInfo[];
  workdir: string;
  data_dir: string;
}
interface ReplyResult {
  status: "completed" | "incomplete" | "aborted";
  stopReason?: string;
  error: string;
}
interface Page {
  epoch: string;
  cursor: number;
  run_id: string | null;
  pending: StreamEvent[];
  compactions: Compaction[];
  reply_result: ReplyResult | null;
  messages: RawMessage[];
  has_more: boolean;
  session: Thread;
}
interface ActiveReply {
  userKey: string;
  accepted: boolean;
  submitting: boolean;
  resync?: boolean;
  cancel?: Promise<unknown>;
}
interface ThreadState {
  modelChoices: Record<string, string>;
  connected: boolean;
  epoch: string;
  cursor: number;
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
  branchingMessageId: number;
}
export const threadTitle = (thread: Thread | undefined) =>
  thread?.title || thread?.preview || "对话";
export const useThread = create<ThreadState>(() => ({
  modelChoices: {},
  connected: false,
  epoch: "",
  cursor: 0,
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
  branchingMessageId: 0,
}));
const set = useThread.setState;
const get = useThread.getState;
const PAGE = 60;
let connection: { controller: AbortController; ready: Promise<void>; resolve: () => void } | null =
  null;
let history: { id: string; version: number; frames: ReplyFrame[] } | null = null;
const sessionCursors = new Map<string, number>();
let globalCursor = 0;
const url = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

// SSE 与子任务轮询可能交错到达，旧快照不能把已提交的累计费用覆盖回去。
function mergeThread(previous: Thread | undefined, incoming: Thread): Thread {
  if (previous && previous.request_count > incoming.request_count) {
    return { ...previous, ...incoming, cost: previous.cost, request_count: previous.request_count };
  }
  return { ...previous, ...incoming };
}

export function isPinned(thread: Thread) {
  return typeof thread.pinned === "number";
}

// 列表顺序：置顶在前（按置顶序号升序），其余按最近活动，与服务端排序一致。
export function compareThreads(a: Thread, b: Thread) {
  if (isPinned(a) && isPinned(b)) {
    return (a.pinned as number) - (b.pinned as number) || b.updated_at - a.updated_at;
  }
  if (isPinned(a)) {
    return -1;
  }
  if (isPinned(b)) {
    return 1;
  }
  return b.updated_at - a.updated_at;
}

function upsertThread(threads: Thread[], session: Thread) {
  const previous = threads.find((thread) => thread.id === session.id);
  return [
    mergeThread(previous, session),
    ...threads.filter((thread) => thread.id !== session.id),
  ].sort(compareThreads);
}

export function updateSessionCost(session: OwnerCost & { id: string }) {
  set((state) => ({
    threads: state.threads.map((thread) =>
      thread.id === session.id ? mergeThread(thread, { ...thread, ...session }) : thread,
    ),
  }));
}
function reset() {
  history = null;
  set((state) => ({
    generation: state.generation + 1,
    active: null,
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
  }));
}
// 最近使用的模型是跨对话、跨刷新的个人偏好，新对话默认沿用它。
const LAST_MODEL_KEY = "agentic.model";
function readLastModelId() {
  try {
    return localStorage.getItem(LAST_MODEL_KEY) || "";
  } catch {
    return "";
  }
}
let lastModelId = readLastModelId();
function rememberModel(id: string) {
  lastModelId = id;
  try {
    localStorage.setItem(LAST_MODEL_KEY, id);
  } catch {
    /* 私隐模式存不了就算了 */
  }
}

// 优先级：本对话里手动选的 > 本对话最近一次发送用的 > 最近使用的模型 > 列表第一个。
export function selectedModel(state: ThreadState = get()) {
  const models = state.status?.models || [];
  const choice = state.modelChoices[state.currentId];
  const last = [...state.messages]
    .reverse()
    .find(
      (message) =>
        message.item.type === "message" && message.item.role === "user" && message.meta?.model_id,
    );
  for (const id of [choice, last?.meta?.model_id, lastModelId]) {
    const found = models.find((model) => model.id === id);
    if (found) {
      return found;
    }
  }
  return models[0];
}

export function selectModel(id: string) {
  rememberModel(id);
  set((state) => ({
    modelChoices: { ...state.modelChoices, [state.currentId]: id },
  }));
}

export function dispose() {
  connection?.controller.abort();
  connection = null;
  sessionCursors.clear();
  globalCursor = 0;
  reset();
  set({ connected: false, modelChoices: {} });
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
export async function init() {
  await Promise.all([loadStatus(), startEvents()]);
}
export function startEvents(): Promise<void> {
  if (connection) {
    return connection.ready;
  }
  let resolve: () => void = () => {};
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  const client = { controller: new AbortController(), ready, resolve };
  connection = client;
  void observeEvents(client);
  return ready;
}
async function observeEvents(client: NonNullable<typeof connection>) {
  const signal = client.controller.signal;
  while (!signal.aborted && connection === client) {
    try {
      await connectEvents(signal, (frame) => {
        if (connection !== client || signal.aborted) {
          return;
        }
        receiveFrame(frame);
        if ("snapshot" in frame) {
          client.resolve();
        }
      });
    } catch {
      if (signal.aborted || connection !== client) {
        break;
      }
      set({ connected: false });
    }
    if (!signal.aborted && connection === client) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 1000);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
  client.resolve();
}
export function receiveFrame(frame: GlobalFrame) {
  if ("snapshot" in frame) {
    sessionCursors.clear();
    for (const session of frame.snapshot.sessions) {
      sessionCursors.set(session.id, frame.cursor);
    }
    globalCursor = frame.cursor;
    set((state) => ({
      connected: true,
      epoch: frame.epoch,
      threads: frame.snapshot.sessions.map((session) =>
        mergeThread(
          state.threads.find((thread) => thread.id === session.id),
          session,
        ),
      ),
    }));
    if (get().active?.submitting) {
      const active = get().active;
      if (active) {
        active.resync = true;
      }
    } else if (get().currentId) {
      void openThread(get().currentId, true);
    }
    return;
  }
  if (frame.epoch !== get().epoch || frame.cursor <= globalCursor) {
    return;
  }
  globalCursor = frame.cursor;
  if ("session" in frame) {
    applySession(frame.session, frame.cursor);
    return;
  }
  if ("deleted_session_id" in frame) {
    const id = frame.deleted_session_id;
    sessionCursors.set(id, frame.cursor);
    set((state) => ({ threads: state.threads.filter((thread) => thread.id !== id) }));
    if (get().currentId === id) {
      reset();
      set({ ready: true, loadError: "对话已删除" });
    }
    return;
  }
  if (frame.event.session) {
    const session = frame.event.session;
    applySession(session, frame.cursor);
  }
  if (get().currentId !== frame.session_id) {
    return;
  }
  if (history?.id === frame.session_id) {
    history.frames.push(frame);
    return;
  }
  applyFrame(frame);
}
function applySession(session: Thread, cursor: number) {
  if (cursor <= (sessionCursors.get(session.id) || 0)) {
    return;
  }
  sessionCursors.set(session.id, cursor);
  set((state) => ({ threads: upsertThread(state.threads, session) }));
}
function applyFrame(frame: ReplyFrame) {
  if (frame.epoch !== get().epoch || frame.cursor <= get().cursor) {
    return;
  }
  set({ cursor: frame.cursor });
  receiveEvent(frame.event);
}
function resultNotes(result: ReplyResult | null): Row[] {
  if (result?.error) {
    return [{ key: crypto.randomUUID(), kind: "system", code: "error", content: result.error }];
  }
  if (result?.status === "aborted") {
    return [{ key: crypto.randomUUID(), kind: "system", code: "stopped" }];
  }
  return [];
}
export async function openThread(id: string, force = false) {
  if (!id || (!force && get().currentId === id && (get().ready || get().busy))) {
    return;
  }
  reset();
  const version = get().generation;
  const loading = { id, version, frames: [] as ReplyFrame[] };
  history = loading;
  set({ currentId: id });
  try {
    const page = await api.get<Page>(`${url(id)}/messages?limit=${PAGE}`);
    if (history !== loading || get().generation !== version) {
      return;
    }
    set((state) => ({
      messages: page.messages,
      notes: resultNotes(page.reply_result),
      compactions: page.compactions,
      hasMore: page.has_more,
      threads:
        (sessionCursors.get(id) || 0) > page.cursor
          ? state.threads
          : upsertThread(state.threads, page.session),
      epoch: page.epoch,
      cursor: page.cursor,
      busy: page.session.running,
      active: page.session.running ? { userKey: "", accepted: true, submitting: false } : null,
      ready: true,
      viewSeq: state.viewSeq + 1,
    }));
    sessionCursors.set(id, Math.max(sessionCursors.get(id) || 0, page.cursor));
    for (const event of page.pending) {
      receiveEvent(event);
    }
    history = null;
    for (const frame of loading.frames) {
      applyFrame(frame);
    }
  } catch (error) {
    if (history === loading && get().generation === version) {
      history = null;
      set({ loadError: error instanceof Error ? error.message : "对话打开失败" });
    }
  }
}
export function createDraft() {
  reset();
  set((state) => {
    const choices = { ...state.modelChoices };
    delete choices[""];
    return { currentId: "", ready: true, viewSeq: state.viewSeq + 1, modelChoices: choices };
  });
}
export async function loadOlder() {
  const { currentId, hasMore, loadingOlder, ready, generation, messages } = get();
  const first = messages.find((message) => message.id > 0);
  if (!currentId || !ready || !hasMore || loadingOlder || !first) {
    return;
  }
  set({ loadingOlder: true });
  try {
    const page = await api.get<Page>(`${url(currentId)}/messages?limit=${PAGE}&before=${first.id}`);
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
  attachments: UploadAttachment[] = [],
): boolean {
  const content = text.trim();
  if ((!content && images.length === 0 && attachments.length === 0) || get().busy || !get().ready) {
    return false;
  }
  if (!get().connected) {
    toast("连接已断开，正在重新连接");
    return false;
  }
  if (images.length + attachments.length > 5) {
    toast("每条消息最多发送 5 个附件");
    return false;
  }
  const model = selectedModel();
  if (!model) {
    toast("请选择对话模型");
    return false;
  }
  rememberModel(model.id);
  const key = retryRow?.key || crypto.randomUUID();
  const item: MessageItem = { type: "message", role: "user", content: [] };
  if (content) {
    item.content.push({ type: "input_text", text: content });
  }
  for (const image of images) {
    item.content.push({ type: "input_image", image_url: image, detail: "auto" });
  }
  const user: RawMessage = {
    uploads: attachments,
    meta: {
      model_id: model.id,
      compact_model_id: model.id,
      ...(attachments.length
        ? {
            attachments: attachments.map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
              url: "",
              path: "",
            })),
          }
        : {}),
    },
    id: 0,
    key,
    item,
    created_at: Date.now(),
    sending: true,
    failed: false,
  };
  const running: ActiveReply = { userKey: key, accepted: false, submitting: true };
  set((state) => ({
    messages: [...state.messages.filter((message) => message.key !== key), user],
    notes: [],
    busy: true,
    stopping: false,
    active: running,
    threads: state.threads.map((thread) =>
      thread.id === state.currentId ? { ...thread, running: true } : thread,
    ),
    viewSeq: state.viewSeq + 1,
  }));
  void submitMessage(
    content,
    key,
    running,
    get().generation,
    model.id,
    onCreated,
    images,
    attachments,
  );
  return true;
}
interface AcceptedMessage {
  epoch: string;
  cursor: number;
  run_id: string;
  message: RawMessage;
  session: Thread;
}
async function submitMessage(
  content: string,
  userKey: string,
  pending: ActiveReply,
  version: number,
  modelId: string,
  onCreated?: (id: string) => void,
  images: string[] = [],
  attachments: UploadAttachment[] = [],
) {
  let id = get().currentId;
  try {
    if (!id) {
      const session = await api.post<Thread>("/api/sessions");
      id = session.id;
      set((state) => ({
        threads: state.threads.some((thread) => thread.id === session.id)
          ? state.threads
          : upsertThread(state.threads, session),
      }));
      if (get().generation === version) {
        set((state) => ({
          currentId: id,
          modelChoices: { ...state.modelChoices, [id]: modelId },
        }));
        onCreated?.(id);
      }
    }
    const accepted = await api.post<AcceptedMessage>(`${url(id)}/messages`, {
      text: content,
      model_id: modelId,
      // 压缩固定使用对话模型；服务端要求每次显式提供。
      compact_model_id: modelId,
      images,
      attachments: attachments.map((file) => ({ name: file.name, data: file.data })),
    });
    if (accepted.epoch === get().epoch) {
      applySession(accepted.session, accepted.cursor);
    }
    pending.accepted = true;
    if (get().active === pending && get().currentId === id) {
      set((state) => ({
        messages: state.messages.map((entry) =>
          entry.key === userKey
            ? { ...entry, ...accepted.message, key: userKey, sending: false, uploads: undefined }
            : entry,
        ),
      }));
      if (get().stopping) {
        void stopRun();
      }
    }
  } catch (error) {
    if (get().active === pending && !pending.accepted) {
      set((state) => ({
        busy: false,
        stopping: false,
        active: null,
        messages: state.messages.map((entry) =>
          entry.key === userKey ? { ...entry, sending: false, failed: true } : entry,
        ),
        notes: [
          {
            key: crypto.randomUUID(),
            kind: "system",
            code: "error",
            content: error instanceof Error ? error.message : "发送失败",
          },
        ],
        threads: state.threads.map((thread) =>
          thread.id === id ? { ...thread, running: false } : thread,
        ),
      }));
    }
  } finally {
    pending.submitting = false;
    if (pending.resync && get().currentId === id) {
      void openThread(id, true);
    }
  }
}
function receiveEvent(event: StreamEvent) {
  switch (event.type) {
    case "message":
    case "reasoning":
    case "function_call":
    case "function_call_output": {
      if (event.item) {
        const item = event.item;
        if (item.type === "message" && item.role === "user" && !event.meta?.task_results) {
          const active = get().active;
          if (active) {
            active.accepted = true;
          }
          const saved = event.saved?.find((record) => record.sequence === event.sequence);
          set((state) => {
            const index = state.messages.findIndex(
              (entry) =>
                (active?.userKey && entry.key === active.userKey) ||
                (saved && entry.id === saved.id),
            );
            const entry: RawMessage = {
              id: 0,
              key: crypto.randomUUID(),
              item,
              meta: event.meta,
              sequence: event.sequence,
              created_at: event.created_at,
              sending: false,
            };
            return {
              busy: true,
              active: active || { userKey: "", accepted: true, submitting: false },
              notes: [],
              messages:
                index < 0
                  ? [...state.messages, entry]
                  : state.messages.map((previous, position) =>
                      position === index
                        ? {
                            ...previous,
                            item,
                            meta: event.meta,
                            sequence: event.sequence,
                            sending: false,
                            uploads: undefined,
                          }
                        : previous,
                    ),
            };
          });
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
                      meta: event.meta,
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
                meta: event.meta,
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
      toast(`请求失败，${event.delayMs / 1000} 秒后重试（${event.attempt}/${event.maxRetries}）`);
      break;
    case "error":
      set({
        notes: [{ key: crypto.randomUUID(), kind: "system", code: "error", content: event.error }],
      });
      break;
    case "done": {
      let notes = get().notes;
      if (event.status === "incomplete" && !notes.some((note) => note.code === "error")) {
        notes = [
          {
            key: crypto.randomUUID(),
            kind: "system",
            code: "error",
            content: event.stopReason || "回复未完成",
          },
        ];
      } else if (event.status === "aborted") {
        notes = [{ key: crypto.randomUUID(), kind: "system", code: "stopped" }];
      }
      set((state) => ({
        notes,
        busy: false,
        stopping: false,
        active: null,
        messages: state.messages
          .filter((entry) => entry.id > 0)
          .map((entry) => ({ ...entry, streaming: false })),
      }));
      break;
    }
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
          meta: record.meta,
          usage: record.usage,
          metering: record.metering,
          created_at: record.created_at,
          sequence: undefined,
        };
      }),
    }));
  }
  if (get().stopping && get().active?.accepted && !get().active?.cancel) {
    void stopRun();
  }
}
export const retrySend = (row: Row, onCreated?: (id: string) => void) =>
  row.failed ? send(row.content || "", row, onCreated, row.images, row.uploads) : false;

export async function branchThread(messageId: number): Promise<string | null> {
  const { currentId, busy, branchingMessageId, generation, viewSeq } = get();
  if (
    !currentId ||
    busy ||
    branchingMessageId ||
    !Number.isSafeInteger(messageId) ||
    messageId <= 0
  ) {
    return null;
  }
  set({ branchingMessageId: messageId });
  try {
    const session = await api.post<Thread>(`${url(currentId)}/branches`, { message_id: messageId });
    set((state) => ({ threads: upsertThread(state.threads, session) }));
    if (
      get().generation !== generation ||
      get().currentId !== currentId ||
      get().viewSeq !== viewSeq ||
      get().busy
    ) {
      return null;
    }
    return session.id;
  } catch (error) {
    toast(error instanceof Error ? error.message : "创建分支失败");
    return null;
  } finally {
    set({ branchingMessageId: 0 });
  }
}

export async function stopRun() {
  const { currentId, busy, generation, active } = get();
  if (!busy || active?.cancel) {
    return;
  }
  set({ stopping: true });
  if (active && !active.accepted) {
    return;
  }
  const cancel = api.post(`${url(currentId)}/cancel`).catch((error) => {
    if (get().generation === generation) {
      if (active) {
        active.cancel = undefined;
      }
      set({ stopping: false });
      toast(error instanceof Error ? error.message : "停止失败");
    }
  });
  if (active) {
    active.cancel = cancel;
  }
  await cancel;
}
// 单个会话置顶或取消置顶；新置顶的会话排在置顶组最前。
export async function pinThread(id: string, pinned: boolean) {
  try {
    const session = await api.patch<Thread>(url(id), { pinned });
    set((state) => ({ threads: upsertThread(state.threads, session) }));
  } catch (error) {
    toast(error instanceof Error ? error.message : "置顶失败");
  }
}

function withPins(threads: Thread[], pins: Map<string, number | null>) {
  return threads
    .map((thread) => ({ ...thread, pinned: pins.get(thread.id) ?? null }))
    .sort(compareThreads);
}

// 一次设定整个置顶组（拖拽排序、拖入、拖出）：先按新顺序乐观更新，失败回滚。
export async function setPinnedThreads(ids: string[]) {
  const previous = new Map(get().threads.map((thread) => [thread.id, thread.pinned]));
  set((state) => ({
    threads: withPins(state.threads, new Map(ids.map((id, index) => [id, index]))),
  }));
  try {
    const result = await api.put<{ sessions: Thread[] }>("/api/sessions/pinned", { ids });
    const confirmed = new Map(result.sessions.map((session) => [session.id, session.pinned]));
    set((state) => ({ threads: withPins(state.threads, confirmed) }));
  } catch (error) {
    set((state) => ({ threads: withPins(state.threads, previous) }));
    toast(error instanceof Error ? error.message : "排序失败");
  }
}

export async function renameThread(id: string, title: string) {
  try {
    await api.patch<Thread>(url(id), { title });
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
    set((state) => ({ threads: state.threads.filter((thread) => thread.id !== id) }));
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败");
    return false;
  }
}
