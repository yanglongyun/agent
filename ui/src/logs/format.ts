import { itemText, type Compaction, type RawMessage } from "../thread/thread";
import type { Cost, Owner, RecordType } from "./types";

/* ── 金额与 token ── */

export function usd(amount: number) {
  if (amount === 0) {
    return "$0";
  }
  if (amount < 0.01) {
    return `$${amount.toFixed(6)}`;
  }
  return `$${amount.toFixed(4)}`;
}

/** 金额拆成主数字和备注。全部未计费时不显示 $0，避免误以为免费。 */
export function costParts(cost: Cost, requests: number) {
  if (requests > 0 && cost.unpriced_requests === requests) {
    return { value: "未计费", note: "" };
  }
  if (cost.unpriced_requests > 0) {
    return { value: usd(cost.amount), note: `另有 ${cost.unpriced_requests} 次请求未计费` };
  }
  return { value: usd(cost.amount), note: "" };
}

/** 一行文字：金额 + 未计费提示。 */
export function costText(cost: Cost, requests: number) {
  const parts = costParts(cost, requests);
  if (parts.note) {
    return `${parts.value} +${cost.unpriced_requests} 次未计费`;
  }
  return parts.value;
}

/** 列表里只放金额，部分未计费的细节在详情里看。 */
export function costShort(cost: Cost, requests: number) {
  return costParts(cost, requests).value;
}

const TOKEN_LABELS: Array<[string, string]> = [
  ["input_tokens", "输入"],
  ["output_tokens", "输出"],
  // Chat Completions 的字段口径与 Claude 不同（prompt 含缓存），汇总时不能与上面同名，否则像两条重复数据。
  ["prompt_tokens", "输入(prompt)"],
  ["completion_tokens", "输出(completion)"],
  ["cache_read_input_tokens", "缓存读取"],
  ["cache_creation_input_tokens", "缓存写入"],
  ["total_tokens", "合计"],
];

/** 厂商原始用量按固定顺序和中文名展示；没见过的字段保留原名，不改写。 */
export function tokenChips(tokens: Record<string, number>) {
  const chips: string[] = [];
  const shown = new Set<string>();
  for (const [key, label] of TOKEN_LABELS) {
    if (key in tokens) {
      chips.push(`${label} ${tokens[key].toLocaleString("en-US")}`);
      shown.add(key);
    }
  }
  for (const key of Object.keys(tokens).sort()) {
    if (!shown.has(key) && tokens[key] > 0) {
      chips.push(`${key} ${tokens[key].toLocaleString("en-US")}`);
    }
  }
  return chips;
}

/** 从单条原始 usage 里取 token 数：顶层以 _tokens 结尾的非负整数，与服务端汇总口径一致。 */
export function tokensOf(usage: Record<string, unknown> | null | undefined) {
  const tokens: Record<string, number> = {};
  for (const [key, value] of Object.entries(usage || {})) {
    if (
      key.endsWith("_tokens") &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      tokens[key] = value;
    }
  }
  return tokens;
}

/* ── 时间 ── */

const pad = (value: number) => String(value).padStart(2, "0");

export function clockTime(at: number) {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 列表里的时间：今天显示时刻，其余显示月日。 */
export function listTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function fullTime(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clockTime(at)}`;
}

/** 统计范围对应的起始时间戳（毫秒）；全部返回 0。 */
export type Range = "today" | "7d" | "30d" | "all";
export function rangeSince(range: Range, now = Date.now()) {
  if (range === "all") {
    return 0;
  }
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  return now - (range === "7d" ? 7 : 30) * 86_400_000;
}

/* ── 对话 / 任务 ── */

export function ownerTitle(owner: Owner) {
  if (owner.kind === "task") {
    return owner.title || "未命名任务";
  }
  return owner.title || owner.preview || "未命名对话";
}

/* ── 单条记录 ── */

export type RecordTone = "user" | "assistant" | "think" | "tool" | "result" | "summary";
export interface DescribedRecord {
  label: string;
  tone: RecordTone;
  /** 工具名、压缩覆盖范围等标题旁的补充信息。 */
  title: string;
  text: string;
  mono: boolean;
  /** 工具结果是否成功；其他记录为 null。 */
  ok: boolean | null;
  images: number;
  files: string[];
}

function pretty(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function describeMessage(message: RawMessage): DescribedRecord {
  const item = message.item;
  const base = { title: "", mono: false, ok: null, images: 0, files: [] as string[] };
  if (item.type === "message") {
    const images = item.content.filter((part) => part.type === "input_image").length;
    const files = (message.meta?.attachments || []).map((file) => file.name);
    if (item.role === "user") {
      return { ...base, label: "用户", tone: "user", text: itemText(item), images, files };
    }
    return { ...base, label: "助手", tone: "assistant", text: itemText(item), images, files };
  }
  if (item.type === "reasoning") {
    return { ...base, label: "思考", tone: "think", text: itemText(item) };
  }
  if (item.type === "function_call") {
    return {
      ...base,
      label: "工具调用",
      tone: "tool",
      title: item.name,
      text: pretty(item.arguments),
      mono: true,
    };
  }
  // function_call_output：output 是 {success,text} 的 JSON 字符串，或带图片的数组。
  const output = item.output;
  const raw =
    typeof output === "string"
      ? output
      : output
          .filter((part) => part.type === "input_text")
          .map((part) => (part as { text: string }).text)
          .join("\n");
  const images =
    typeof output === "string" ? 0 : output.filter((p) => p.type === "input_image").length;
  try {
    const parsed = JSON.parse(raw) as { success?: boolean; text?: string };
    if (typeof parsed.text === "string") {
      return {
        ...base,
        label: "工具结果",
        tone: "result",
        text: parsed.text,
        mono: true,
        ok: parsed.success !== false,
        images,
      };
    }
  } catch {
    /* 不是约定格式时原样显示 */
  }
  return { ...base, label: "工具结果", tone: "result", text: raw, mono: true, images };
}

export function describeCompaction(compaction: Compaction): DescribedRecord {
  return {
    label: "摘要",
    tone: "summary",
    title: `已压缩到第 ${compaction.through_id} 条`,
    text: compaction.summary,
    mono: false,
    ok: null,
    images: 0,
    files: [],
  };
}

export const typeOptions: Array<{ value: RecordType; label: string }> = [
  { value: "all", label: "全部" },
  { value: "message", label: "消息" },
  { value: "tool", label: "工具" },
  { value: "reasoning", label: "思考" },
  { value: "summary", label: "摘要" },
  { value: "usage", label: "有用量" },
];
