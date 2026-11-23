// 界面消息行与附件的模型。原始记录由 thread/ 引擎维护，这里只描述显示层形状。
type AttachmentBase = { id: string; name: string; mimeType: string; size: number };
export type ImageAttachment = AttachmentBase & {
  kind: "image";
  source: { kind: "local"; file: File } | { kind: "url"; url: string };
};
export type FileAttachment = AttachmentBase & {
  kind: "file";
  // 本地待发送的 File；已保存的附件只有 url；撤回归还的草稿带 base64 data。
  file?: File;
  data?: string;
  url?: string;
};
export type Attachment = ImageAttachment | FileAttachment;
export type UsageRecord = {
  model: string;
  raw: Record<string, unknown>;
  costUsd: number;
};
export interface Row {
  // 助手正文的服务端消息 ID，用于创建分支。
  seq?: number;
  usage?: UsageRecord[];
  _key: string;
  role: "user" | "assistant" | "system" | "developer" | "tool";
  /** 系统消息的来源：决定展示成错误条、停止胶囊、摘要折叠卡还是输出块。 */
  notice?: "error" | "stopped" | "compact" | "output";
  type?: "function_call";
  content?: string;
  created_at?: number;
  reasoning?: string;
  streaming?: boolean;
  failed?: boolean;
  sending?: boolean;
  attachments?: Attachment[];
  callId?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  images?: string[];
  status?: "running" | "done";
}
