import { costParts } from "./format";
import type { Cost } from "./types";

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat-card">
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
}: {
  label: string;
  cost: Cost;
  requests: number;
}) {
  const parts = costParts(cost, requests);
  return <Stat label={label} value={parts.value} note={parts.note} />;
}
