// 对话门面：chatnext 的界面形状，底下是 thread/ 的 SSE 引擎。
// 组件只依赖本模块；引擎的 epoch/cursor、保存确认、断线重连都对界面透明。
import { create } from "zustand";
import { toast } from "@/overlay/toast";
import { t } from "@/i18n";
import {
  branchThread,
  createDraft,
  openThread,
  pinThread,
  recallMessage,
  removeThread,
  renameThread,
  resendFailed,
  send as engineSend,
  setPinnedThreads,
  stopRun,
  threadTitle,
  useThread,
  type Thread,
} from "@/thread/store";
import { itemText, type Compaction, type RawMessage } from "@/thread/thread";
import { validateAttachments } from "@/thread/attachments";
import type { Attachment, FileAttachment, ImageAttachment, Row, UsageRecord } from "./thread";

export interface Conversation {
  id: string;
  title: string;
  pinned: number;
  position: number;
  created_at: number;
  updated_at: number;
  running?: boolean;
}

type RestoredDraft = { text: string; attachments: Attachment[] } | null;

type State = {
  conversations: Conversation[];
  currentId: string;
  messages: Row[];
  busy: boolean;
  aborting: boolean;
  ready: boolean;
  connected: boolean;
  viewKey: number;
  indexReady: boolean;
  generation: number;
  restoredDraft: RestoredDraft;
};

export const useConversation = create<State>(() => ({
  conversations: [],
  currentId: "",
  messages: [],
  busy: false,
  aborting: false,
  ready: false,
  connected: false,
  viewKey: 0,
  indexReady: false,
  generation: 0,
  restoredDraft: null,
}));

const SAVED_ID = "agent.conversation.id";
const savedId = () => {
  try {
    return localStorage.getItem(SAVED_ID) || "";
  } catch {
    return "";
  }
};
const saveId = (id: string) => {
  try {
    if (id) {
      localStorage.setItem(SAVED_ID, id);
    } else {
      localStorage.removeItem(SAVED_ID);
    }
  } catch {
    /* ignore */
  }
};

function mapConversation(thread: Thread): Conversation {
  return {
    id: thread.id,
    title: thread.title || thread.preview || "",
    pinned: thread.pinned === null ? 0 : 1,
    position: thread.pinned ?? 0,
    created_at: thread.created_at,
    updated_at: thread.updated_at,
    running: thread.running,
  };
}

function usageRecord(message: RawMessage): UsageRecord {
  return {
    model: message.metering?.model || "",
    raw: message.usage || {},
    costUsd: message.metering?.cost?.amount ?? 0,
  };
}

function userAttachments(message: RawMessage): Attachment[] {
  const result: Attachment[] = [];
  if (message.item.type === "message") {
    for (const part of message.item.content) {
      if (part.type === "input_image") {
        result.push({
          id: part.image_url,
          name: "图片",
          mimeType: "image/*",
          size: 0,
          kind: "image",
          source: { kind: "url", url: part.image_url },
        });
      }
    }
  }
  if (message.meta?.attachments) {
    for (const file of message.meta.attachments) {
      result.push({
        id: file.url || file.path || file.name,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        kind: "file",
        url: file.url || undefined,
      });
    }
  }
  // 发送中的乐观行：附件还没有服务端地址，只展示名字与大小。
  if (message.uploads) {
    for (const file of message.uploads) {
      result.push({
        id: `upload:${file.name}`,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        kind: "file",
        data: file.data,
      });
    }
  }
  return result;
}

function projectMessages(
  messages: RawMessage[],
  compactions: Compaction[],
  notes: { key: string; code?: string; content?: string }[],
  busy: boolean,
): Row[] {
  const rows: Row[] = [];
  const calls = new Map<string, Row>();
  let compactIndex = 0;
  const summaries = [...compactions].sort((a, b) => a.through_id - b.through_id || a.id - b.id);
  const appendCompaction = (summary: Compaction) => {
    rows.push({
      _key: `compact:${summary.id}`,
      role: "system",
      notice: "compact",
      content: summary.summary,
      created_at: summary.created_at,
    });
  };
  let turnUsage: UsageRecord[] = [];
  let lastAnswer: Row | null = null;
  for (const message of messages) {
    while (
      compactIndex < summaries.length &&
      message.id > 0 &&
      summaries[compactIndex].through_id < message.id
    ) {
      appendCompaction(summaries[compactIndex++]);
    }
    const item = message.item;
    const key = message.key || `message:${message.id}`;
    if (item.type === "message" && item.role === "user" && message.meta?.task_results) {
      continue;
    }
    switch (item.type) {
      case "message": {
        if (item.role === "user") {
          turnUsage = [];
          lastAnswer = null;
          rows.push({
            _key: key,
            seq: message.id > 0 ? message.id : undefined,
            role: "user",
            content: itemText(item),
            created_at: message.created_at,
            failed: message.failed,
            sending: message.sending,
            attachments: userAttachments(message),
          });
        } else {
          const answer: Row = {
            _key: key,
            seq: message.id > 0 ? message.id : undefined,
            role: item.role,
            content: itemText(item),
            created_at: message.created_at,
            streaming: message.streaming,
            usage: turnUsage.length ? [...turnUsage] : undefined,
          };
          lastAnswer = answer;
          rows.push(answer);
        }
        break;
      }
      case "reasoning": {
        rows.push({
          _key: key,
          role: "assistant",
          reasoning: itemText(item),
          created_at: message.created_at,
          streaming: message.streaming,
        });
        break;
      }
      case "function_call": {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(item.arguments);
        } catch {
          args = { arguments: item.arguments };
        }
        const row: Row = {
          _key: `tool:${item.call_id}`,
          role: "tool",
          type: "function_call",
          callId: item.call_id,
          name: item.name,
          args,
          result: "",
          status: busy ? "running" : "done",
          created_at: message.created_at,
        };
        calls.set(item.call_id, row);
        rows.push(row);
        break;
      }
      case "function_call_output": {
        const call = calls.get(item.call_id);
        const parts = typeof item.output === "string" ? [] : item.output;
        const text =
          typeof item.output === "string"
            ? item.output
            : parts
                .filter((part) => "text" in part)
                .map((part) => ("text" in part ? part.text : ""))
                .join("\n");
        const images = parts
          .filter((part) => part.type === "input_image")
          .map((part) => ("image_url" in part ? part.image_url : ""))
          .filter(Boolean);
        if (call) {
          try {
            const parsed = JSON.parse(text) as { success: boolean; text: string };
            call.result = parsed.text;
            call.failed = !parsed.success;
          } catch {
            call.result = text;
          }
          call.images = images;
          call.status = "done";
        } else {
          rows.push({
            _key: `output:${item.call_id}`,
            role: "system",
            notice: "output",
            content: text,
            created_at: message.created_at,
          });
        }
        break;
      }
    }
    if (message.usage) {
      turnUsage.push(usageRecord(message));
      // 用量记在该轮最后一条助手正文上：同轮后续请求继续累加到同一行。
      if (lastAnswer) {
        lastAnswer.usage = [...turnUsage];
      }
    }
    while (
      compactIndex < summaries.length &&
      message.id > 0 &&
      summaries[compactIndex].through_id === message.id
    ) {
      appendCompaction(summaries[compactIndex++]);
    }
  }
  while (compactIndex < summaries.length) {
    appendCompaction(summaries[compactIndex++]);
  }
  for (const note of notes) {
    const stopped = note.code === "stopped" && !note.content;
    rows.push({
      _key: note.key,
      role: "system",
      notice: stopped ? "stopped" : "error",
      content: stopped ? t("conversation.stopped") : note.content || "",
    });
  }
  return rows;
}

function project() {
  const state = useThread.getState();
  useConversation.setState({
    conversations: state.threads.map(mapConversation),
    currentId: state.currentId,
    messages: projectMessages(state.messages, state.compactions, state.notes, state.busy),
    busy: state.busy,
    aborting: state.stopping,
    ready: state.ready,
    connected: state.connected,
    viewKey: state.viewSeq,
    indexReady: state.epoch !== "",
    generation: state.generation,
  });
}
useThread.subscribe(project);

export function initConversation() {
  const { indexReady, currentId, busy } = useConversation.getState();
  if (!indexReady || currentId || busy) {
    return;
  }
  const id = useConversation.getState().conversations.find((row) => row.id === savedId())?.id;
  if (id) {
    void switchConversation(id);
  }
}

export function createConversation() {
  createDraft();
  saveId("");
}

export async function switchConversation(id: string) {
  if (!id || id === useConversation.getState().currentId) {
    return;
  }
  saveId(id);
  await openThread(id);
}

export async function setPinned(id: string, pinned: boolean, order?: string[]) {
  if (order) {
    await setPinnedThreads(order);
  } else {
    await pinThread(id, pinned);
  }
}

export const reorderPinned = (ids: string[]) => setPinnedThreads(ids);

export const renameConversation = (id: string, title: string) => renameThread(id, title);

export async function removeConversation(id: string) {
  const ok = await removeThread(id);
  if (ok && id === useConversation.getState().currentId) {
    createConversation();
  }
  return ok;
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// 发送前把界面附件转成引擎负载：图片内联 data URL，文件转 base64。
async function packAttachments(attachments: Attachment[]) {
  const images: string[] = [];
  const files: { name: string; type: string; size: number; data: string }[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      if (attachment.source.kind === "local") {
        const data = await fileToBase64(attachment.source.file);
        images.push(`data:${attachment.mimeType};base64,${data}`);
      } else {
        images.push(attachment.source.url);
      }
    } else {
      const data = attachment.data ?? (attachment.file ? await fileToBase64(attachment.file) : "");
      files.push({
        name: attachment.name,
        type: attachment.mimeType,
        size: attachment.size,
        data,
      });
    }
  }
  return { images, files };
}

export async function send(text: string, attachments: Attachment[] = []) {
  if ((!text.trim() && !attachments.length) || useConversation.getState().busy) {
    return;
  }
  const problem = validateAttachments(
    attachments.map((attachment) => ({
      size: attachment.size,
      type: attachment.mimeType,
    })),
  );
  if (problem) {
    toast(problem);
    return;
  }
  try {
    const { images, files } = await packAttachments(attachments);
    engineSend(text, null, saveId, images, files);
  } catch (error) {
    toast(error instanceof Error ? error.message : "附件读取失败");
  }
}

export function retry(row: Row) {
  resendFailed(row._key, saveId);
}

export function abort() {
  void stopRun();
}

export async function branchConversation(seq: number) {
  const id = await branchThread(seq);
  if (id) {
    await switchConversation(id);
  }
}

// 撤回一条用户消息：服务端截断历史，原文与附件放回输入框。
export async function recall(row: Row) {
  const engine = useThread.getState();
  const target = engine.messages.find(
    (message) => (message.key || `message:${message.id}`) === row._key && message.id > 0,
  );
  if (!target || engine.busy) {
    return;
  }
  const last = [...engine.messages].reverse().find((message) => message.id > 0);
  if (!last) {
    return;
  }
  try {
    const draft = await recallMessage(engine.currentId, target.id, last.id);
    const attachments: Attachment[] = draft.attachments.map((file) => ({
      id: `recall:${file.name}`,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      kind: "file",
      data: file.data,
    }));
    useConversation.setState({ restoredDraft: { text: draft.text, attachments } });
  } catch (error) {
    toast(error instanceof Error ? error.message : "撤回失败");
  }
}

export const consumeRestoredDraft = () => useConversation.setState({ restoredDraft: null });

// 子任务详情与主对话共用同一套投影规则。
export const projectRows = projectMessages;

export { threadTitle };
export type { FileAttachment, ImageAttachment };
