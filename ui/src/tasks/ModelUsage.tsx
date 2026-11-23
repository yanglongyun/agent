import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { tokenChips } from "@/thread/metering";
import { useT } from "@/i18n";

type UsagePage = {
  requests: number;
  cost: { amount: number; currency: string; unpriced_requests: number };
  tokens: Record<string, number>;
  models: {
    model: string;
    requests: number;
    cost: { amount: number; currency: string; unpriced_requests: number };
    tokens: Record<string, number>;
  }[];
};

function costText(cost: UsagePage["cost"], requests: number) {
  if (requests > 0 && cost.unpriced_requests === requests) {
    return `${requests} 次请求尚未计费`;
  }
  const amount = cost.amount.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 9,
  });
  const priced = `预估 ${cost.currency} ${amount}`;
  return cost.unpriced_requests ? `${priced} · ${cost.unpriced_requests} 次未计费` : priced;
}

// 对话详情里的「各模型消耗」：对话中途可以切换模型，按模型分别列出请求数、金额和 token。
// 数据来自 GET /api/sessions/:id/usage，含主请求、全部子任务与摘要。
export function ModelUsage({ sessionId }: { sessionId: string }) {
  const t = useT();
  const [page, setPage] = useState<UsagePage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setPage(null);
    setError("");
    api
      .get<UsagePage>(`/api/sessions/${encodeURIComponent(sessionId)}/usage`)
      .then((result) => {
        if (current) {
          setPage(result);
        }
      })
      .catch((failure) => {
        if (current) {
          setError(failure instanceof Error ? failure.message : t("common.reading"));
        }
      });
    return () => {
      current = false;
    };
  }, [sessionId]);
  return (
    <section className="model-usage">
      <h3>{t("details.modelUsage")}</h3>
      {error && <p className="note is-error">{error}</p>}
      {!page && !error && <p className="note">{t("common.reading")}</p>}
      {page && page.models.length === 0 && <p className="note">{t("details.noUsage")}</p>}
      {page && page.models.length > 0 && (
        <div className="card usage-card">
          {page.models.map((model) => {
            const chips = tokenChips(Object.entries(model.tokens));
            return (
              <div key={model.model} className="usage-row">
                <div className="usage-row-head">
                  <b className="mono">{model.model}</b>
                  <span className="usage-row-count">
                    {t("tasks.requests", { n: model.requests })}
                  </span>
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
