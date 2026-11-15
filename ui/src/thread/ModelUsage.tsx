import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { costText, tokenChips } from "../logs/format";
import type { RecordsPage } from "../logs/types";

// 对话详情里的「各模型消耗」：对话中途可以切换模型，这里按模型分别列出请求数、金额和 token。
// 数据来自日志接口的 total_summary，含子任务和上下文压缩，合计与对话累计费用一致。
export function ModelUsage({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState<RecordsPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setPage(null);
    setError("");
    api
      .get<RecordsPage>(
        `/api/logs/records?kind=session&id=${encodeURIComponent(sessionId)}&limit=1`,
      )
      .then((result) => {
        if (current) {
          setPage(result);
        }
      })
      .catch((failure) => {
        if (current) {
          setError(failure instanceof Error ? failure.message : "读取失败");
        }
      });
    return () => {
      current = false;
    };
  }, [sessionId]);

  const summary = page?.total_summary;
  return (
    <section className="model-usage">
      <h3>各模型消耗</h3>
      {error && <p className="note is-error">{error}</p>}
      {!page && !error && <p className="note">正在读取…</p>}
      {summary && summary.models.length === 0 && <p className="note">还没有模型请求</p>}
      {summary && summary.models.length > 0 && (
        <div className="card usage-card">
          {summary.models.map((model) => {
            const chips = tokenChips(model.tokens);
            return (
              <div key={model.model} className="usage-row">
                <div className="usage-row-head">
                  <b className="mono">{model.model}</b>
                  <span className="usage-row-count">{model.requests} 次请求</span>
                  <span className="usage-row-cost">{costText(model.cost, model.requests)}</span>
                </div>
                {chips.length > 0 && (
                  <span className="pill-row">
                    {chips.map((chip) => (
                      <span key={chip} className="pill">
                        {chip}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
