import type { Row } from "./thread";
export type TurnEntry = {
  kind: "think" | "tool" | "text";
  row: Row;
};
type Block =
  | {
      kind: "message";
      key: string;
      message: Row;
      final?: boolean;
    }
  | {
      kind: "flat";
      key: string;
      items: TurnEntry[];
    }
  | {
      kind: "turn";
      key: string;
      items: TurnEntry[];
      durationMs: number | null;
    };
export function buildTurns(messages: Row[], busy: boolean): Block[] {
  const blocks: Block[] = [];
  let entries: TurnEntry[] = [];
  let key = "head";
  let start: number | undefined;
  let end: number | undefined;
  const flush = (live: boolean) => {
    if (!entries.length) {
      return;
    }
    const list = entries;
    entries = [];
    const finalIndex = list.findLastIndex((entry) => entry.kind === "text" && !entry.row.streaming);
    if (live || finalIndex < 0) {
      blocks.push({ kind: "flat", key: `flat:${key}`, items: list });
    } else {
      const final = list[finalIndex];
      const process = list.filter((_, index) => index !== finalIndex);
      if (process.length) {
        blocks.push({
          kind: "turn",
          key: `turn:${key}`,
          items: process,
          durationMs: start && end && end > start ? end - start : null,
        });
      }
      blocks.push({ kind: "message", key: final.row._key, message: final.row, final: true });
    }
  };
  for (const row of messages) {
    if (row.role === "user" || row.role === "system" || row.role === "developer") {
      flush(false);
      key = row._key;
      start = row.created_at;
      end = undefined;
      blocks.push({ kind: "message", key: row._key, message: row });
    } else if (row.type === "function_call") {
      entries.push({ kind: "tool", row });
      end = row.created_at ?? end;
    } else if (row.role === "assistant") {
      if (row.reasoning) {
        entries.push({ kind: "think", row });
      }
      if (row.content) {
        entries.push({ kind: "text", row });
      }
      end = row.created_at ?? end;
    }
  }
  flush(busy);
  return blocks;
}
