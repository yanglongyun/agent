import { useState } from "react";
import type { Compaction, RawMessage } from "../thread/thread";
import {
  clockTime,
  describeCompaction,
  describeMessage,
  fullTime,
  tokenChips,
  tokensOf,
  usd,
} from "./format";

export type Entry =
  | { kind: "message"; key: string; at: number; order: number; message: RawMessage }
  | { kind: "compaction"; key: string; at: number; order: number; compaction: Compaction };

const CLAMP_LENGTH = 600;

// 一条日志记录：类型、时间、正文，以及这次模型请求的 token 与费用，可展开查看原始 JSON。
export function RecordItem({ entry }: { entry: Entry }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const isMessage = entry.kind === "message";
  const described = isMessage
    ? describeMessage(entry.message)
    : describeCompaction(entry.compaction);
  const usage = isMessage ? entry.message.usage : entry.compaction.usage;
  const metering = isMessage ? entry.message.metering : entry.compaction.metering;
  const chips = tokenChips(tokensOf(usage));
  const long = described.text.length > CLAMP_LENGTH;
  const textClasses = ["log-text"];
  if (described.mono) {
    textClasses.push("mono");
  }
  if (long && !expanded) {
    textClasses.push("clamped");
  }
  let costChip = "";
  if (metering?.cost) {
    costChip = usd(metering.cost.amount);
  } else if (metering) {
    costChip = "未计费";
  }
  const raw = isMessage
    ? {
        id: entry.message.id,
        item: entry.message.item,
        meta: entry.message.meta,
        usage: entry.message.usage,
        metering: entry.message.metering,
      }
    : entry.compaction;

  return (
    <article className={`log-record tone-${described.tone}`}>
      <div className="log-record-head">
        <span className="log-kind">{described.label}</span>
        {described.title && <span className="log-title mono">{described.title}</span>}
        {described.ok !== null && (
          <span className={`badge ${described.ok ? "is-ok" : "is-danger"}`}>
            {described.ok ? "成功" : "失败"}
          </span>
        )}
        <span className="log-time" title={fullTime(entry.at)}>
          {clockTime(entry.at)}
        </span>
      </div>
      {described.text ? (
        <div className={textClasses.join(" ")}>{described.text}</div>
      ) : (
        <div className="log-text logs-muted">（没有文字内容）</div>
      )}
      {(described.images > 0 || described.files.length > 0) && (
        <div className="pill-row">
          {described.images > 0 && <span className="pill">图片 × {described.images}</span>}
          {described.files.map((name) => (
            <span key={name} className="pill">
              {name}
            </span>
          ))}
        </div>
      )}
      {(chips.length > 0 || costChip) && (
        <div className="pill-row log-usage">
          {metering?.model && <span className="pill mono">{metering.model}</span>}
          {chips.map((chip) => (
            <span key={chip} className="pill">
              {chip}
            </span>
          ))}
          {costChip && <span className="pill is-accent">{costChip}</span>}
        </div>
      )}
      <div className="log-actions">
        {long && (
          <button type="button" onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起" : "展开全文"}
          </button>
        )}
        <button type="button" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? "隐藏原始数据" : "原始数据"}
        </button>
      </div>
      {showRaw && <pre className="well log-raw">{JSON.stringify(raw, null, 2)}</pre>}
    </article>
  );
}
