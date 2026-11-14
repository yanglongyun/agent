import { costParts } from "./format";
import type { Cost } from "./types";

export function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card${accent ? " is-accent" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

/** 金额卡片：主数字是金额，未计费的请求数放在备注里。 */
export function CostStat({
  label,
  cost,
  requests,
  accent,
}: {
  label: string;
  cost: Cost;
  requests: number;
  accent?: boolean;
}) {
  const parts = costParts(cost, requests);
  return <Stat label={label} value={parts.value} note={parts.note} accent={accent} />;
}
