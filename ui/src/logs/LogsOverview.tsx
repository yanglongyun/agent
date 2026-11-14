import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { costText, rangeSince, tokenChips, type Range } from "./format";
import { CostStat, Stat } from "./Stat";
import type { Overview, Summary } from "./types";

const ranges: Array<{ value: Range; label: string }> = [
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
];
const sources: Array<{ key: keyof Overview["sources"]; label: string }> = [
  { key: "session", label: "对话" },
  { key: "task", label: "子任务" },
  { key: "compaction", label: "上下文压缩" },
];

function Pills({ tokens }: { tokens: Record<string, number> }) {
  const chips = tokenChips(tokens);
  if (chips.length === 0) {
    return <span className="logs-muted">无 token 记录</span>;
  }
  return (
    <span className="pill-row">
      {chips.map((chip) => (
        <span key={chip} className="detail-pill">
          {chip}
        </span>
      ))}
    </span>
  );
}

function SourceRow({ label, summary }: { label: string; summary: Summary }) {
  return (
    <div className="logs-row-card">
      <div className="logs-row-line">
        <b>{label}</b>
        <span>{costText(summary.cost, summary.requests)}</span>
      </div>
      <div className="logs-row-line sub">
        <span>{summary.requests} 次请求</span>
        <Pills tokens={summary.tokens} />
      </div>
    </div>
  );
}

// 用量总览：按时间范围汇总全部请求的 token 与费用，并按来源和模型拆开。
export function LogsOverview() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setData(null);
    async function load() {
      try {
        const result = await api.get<Overview>(`/api/logs/summary?since=${rangeSince(range)}`);
        if (current) {
          setData(result);
          setError("");
        }
      } catch (failure) {
        if (current) {
          setError(failure instanceof Error ? failure.message : "读取失败");
        }
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [range]);

  return (
    <div className="logs-detail">
      <div className="detail-head">
        <h2 className="detail-title">用量总览</h2>
        <p className="detail-meta">全部对话、子任务和上下文压缩的模型请求。</p>
        <div className="chip-group" role="group" aria-label="时间范围">
          {ranges.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`filter-chip${range === item.value ? " selected" : ""}`}
              aria-pressed={range === item.value}
              onClick={() => setRange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="logs-note is-error">{error}</p>}
      {!data && !error && <p className="logs-note">正在读取…</p>}
      {data && data.requests === 0 && <p className="logs-note">这个时间范围内没有用量记录</p>}
      {data && data.requests > 0 && (
        <div className="detail-body">
          <div className="stat-grid">
            <CostStat label="预估费用" cost={data.cost} requests={data.requests} />
            <Stat label="请求数" value={data.requests.toLocaleString("en-US")} />
            <Stat label="使用的模型" value={String(data.models.length)} />
          </div>
          <section className="logs-section">
            <h3>Token</h3>
            <Pills tokens={data.tokens} />
            <p className="logs-note-left">
              不同厂商的 token 字段口径不同，按原始字段分别累计，不合并。
            </p>
          </section>
          <section className="logs-section">
            <h3>按来源</h3>
            {sources.map((source) => (
              <SourceRow key={source.key} label={source.label} summary={data.sources[source.key]} />
            ))}
          </section>
          <section className="logs-section">
            <h3>按模型</h3>
            {data.models.map((model) => (
              <div key={model.model} className="logs-row-card">
                <div className="logs-row-line">
                  <b className="mono">{model.model}</b>
                  <span>{costText(model.cost, model.requests)}</span>
                </div>
                <div className="logs-row-line sub">
                  <span>{model.requests} 次请求</span>
                  <Pills tokens={model.tokens} />
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
