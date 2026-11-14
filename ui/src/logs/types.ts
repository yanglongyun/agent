import type { Compaction, RawMessage } from "../thread/thread";

// 与 /api/logs/* 的返回结构一一对应。
export interface Cost {
  amount: number;
  currency: string;
  unpriced_requests: number;
}
export interface ModelSummary {
  model: string;
  requests: number;
  cost: Cost;
  tokens: Record<string, number>;
}
export interface Summary {
  requests: number;
  cost: Cost;
  tokens: Record<string, number>;
  models: ModelSummary[];
}
export interface Overview extends Summary {
  since: number;
  sources: { session: Summary; task: Summary; compaction: Summary };
}
export interface Owner {
  kind: "session" | "task";
  id: string;
  title: string;
  preview: string;
  session_id: string | null;
  session_title: string | null;
  model: string | null;
  status: string | null;
  cost: Cost;
  request_count: number;
  message_count: number;
  created_at: number;
  updated_at: number;
}
export interface OwnersPage {
  owners: Owner[];
  has_more: boolean;
}
export interface RecordsPage {
  owner: Owner;
  summary: Summary;
  records: RawMessage[];
  has_more: boolean;
  compactions: Compaction[];
}
export type RecordType = "all" | "message" | "tool" | "reasoning" | "summary" | "usage";
