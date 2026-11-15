// 把消息行组装成对话里的显示区块。纯函数，不依赖界面状态，方便单独测试。
import { dayLabel } from "./format";
import type { TurnEntry } from "./Process";
import type { Row, UsageRecord } from "./thread";

export type Block =
  | {
      kind: "day";
      key: string;
      label: string;
    }
  | {
      kind: "message";
      key: string;
      row: Row;
      final?: boolean;
      usage?: UsageRecord[];
    }
  // 一轮进行中(或没有最终回答)时,思考和工具按顺序平铺在对话里。
  | {
      kind: "flat";
      key: string;
      items: TurnEntry[];
    }
  // 一轮完成后,过程收进「已工作 Xs」折叠条,最终回答留在外面。
  | {
      kind: "turn";
      key: string;
      items: TurnEntry[];
      durationMs: number | null;
    };

export function buildBlocks(rows: Row[], busy: boolean): Block[] {
  const output: Block[] = [];
  let lastDay = "";

  let entries: TurnEntry[] = [];
  let usageRecords: UsageRecord[] = [];
  let turnStartAt: number | undefined;
  let turnLastAt: number | undefined;

  const noteAt = (at?: number) => {
    if (at) {
      turnLastAt = at;
    }
  };

  // 过程按顺序平铺:连续的思考 / 工具合成一块,中间正文单独成消息。
  const pushFlat = (list: TurnEntry[]) => {
    let run: TurnEntry[] = [];
    const flushRun = () => {
      if (run.length) {
        output.push({ kind: "flat", key: `flat:${run[0].row.key}`, items: run });
        run = [];
      }
    };
    for (const item of list) {
      if (item.kind === "text") {
        flushRun();
        output.push({ kind: "message", key: item.row.key, row: item.row });
      } else {
        run.push(item);
      }
    }
    flushRun();
  };

  // 一轮收尾:进行中或没有最终回答(例如中途停止)就平铺;
  // 已完成且有最终回答,过程收进折叠条,用量挂在最终回答的「更多」里。
  const flushTurn = (live: boolean) => {
    const list = entries;
    const records = usageRecords;
    const startAt = turnStartAt;
    const lastAt = turnLastAt;
    entries = [];
    usageRecords = [];
    turnStartAt = undefined;
    turnLastAt = undefined;
    if (!list.length) {
      return;
    }
    let finalIndex = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].kind === "text" && !list[i].row.streaming) {
        finalIndex = i;
        break;
      }
    }
    if (live || finalIndex < 0) {
      pushFlat(list);
      return;
    }
    const final = list[finalIndex];
    const process = list.filter((_entry, index) => index !== finalIndex);
    if (process.length) {
      output.push({
        kind: "turn",
        key: `turn:${process[0].row.key}`,
        items: process,
        durationMs: startAt && lastAt && lastAt > startAt ? lastAt - startAt : null,
      });
    }
    output.push({
      kind: "message",
      key: final.row.key,
      row: final.row,
      final: true,
      usage: records,
    });
  };

  for (const row of rows) {
    const day = dayLabel(row.at);
    if (day && day !== lastDay) {
      flushTurn(false);
      output.push({
        kind: "day",
        key: `day:${row.key}`,
        label: day,
      });
      lastDay = day;
    }

    if (row.kind === "user") {
      flushTurn(false);
      turnStartAt = row.at;
      output.push({
        kind: "message",
        key: row.key,
        row,
      });
      continue;
    }
    if (row.kind === "tool") {
      entries.push({
        kind: "tool",
        row,
      });
      noteAt(row.at);
      continue;
    }
    if (row.kind === "usage") {
      if (row.usageRecord) {
        usageRecords.push(row.usageRecord);
      }
      continue;
    }
    if (row.kind === "assistant") {
      if (row.reasoning) {
        entries.push({
          kind: "think",
          row,
        });
      }
      if (row.content) {
        entries.push({
          kind: "text",
          row,
        });
      }
      noteAt(row.at);
      continue;
    }
    flushTurn(false);
    output.push({
      kind: "message",
      key: row.key,
      row,
    });
  }
  flushTurn(busy);
  return output;
}
