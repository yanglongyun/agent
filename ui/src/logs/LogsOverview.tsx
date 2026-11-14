import { useEffect, useState } from "react";
import { Icon } from "../icons/Icon";
import { api } from "../lib/api";
import { StageHead } from "../shell/heads";
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
        <span key={chip} className="pill">
          {chip}
        </span>
      ))}
    </span>
  );
}

function SourceRow({ label, summary }: { label: string; summary: Summary }) {
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <b>{label}</b>
        <span className="usage-row-count">{summary.requests.toLocaleString("en-US")} 次请求</span>
        <span className="usage-row-cost">{costText(summary.cost, summary.requests)}</span>
      </div>
      <Pills tokens={summary.tokens} />
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
    <section className="stage">
      <StageHead title="用量总览" />
      <main className="stage-scroll">
        <div className="page">
          <div className="page-intro">
            <p>全部对话、子任务和上下文压缩的模型请求。</p>
            <div className="seg" role="group" aria-label="时间范围">
              {ranges.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`seg-item${range === item.value ? " selected" : ""}`}
                  aria-pressed={range === item.value}
                  onClick={() => setRange(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="note is-error">{error}</p>}
          {!data && !error && <p className="note">正在读取…</p>}
          {data && data.requests === 0 && (
            <div className="empty">
              <Icon name="chart" size={24} />
              <strong>还没有用量</strong>
              <span>这个时间范围内没有模型请求。</span>
            </div>
          )}
          {data && data.requests > 0 && (
            <>
              <div className="stat-grid">
                <CostStat label="预估费用" cost={data.cost} requests={data.requests} accent />
                <Stat label="请求数" value={data.requests.toLocaleString("en-US")} />
                <Stat label="使用的模型" value={String(data.models.length)} />
              </div>
              <section className="logs-section">
                <h3>Token</h3>
                <div className="card usage-card">
                  <div className="usage-row">
                    <Pills tokens={data.tokens} />
                    <p className="field-note">
                      不同厂商的 token 字段口径不同，按原始字段分别累计，不合并。
                    </p>
                  </div>
                </div>
              </section>
              <section className="logs-section">
                <h3>按来源</h3>
                <div className="card usage-card">
                  {sources.map((source) => (
                    <SourceRow
                      key={source.key}
                      label={source.label}
                      summary={data.sources[source.key]}
                    />
                  ))}
                </div>
              </section>
              <section className="logs-section">
                <h3>按模型</h3>
                <div className="card usage-card">
                  {data.models.map((model) => (
                    <div key={model.model} className="usage-row">
                      <div className="usage-row-head">
                        <b className="mono">{model.model}</b>
                        <span className="usage-row-count">
                          {model.requests.toLocaleString("en-US")} 次请求
                        </span>
                        <span className="usage-row-cost">
                          {costText(model.cost, model.requests)}
                        </span>
                      </div>
                      <Pills tokens={model.tokens} />
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </section>
  );
}
