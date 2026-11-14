import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Icon } from "../icons/Icon";
import { api } from "../lib/api";
import { labels } from "../tasks/status";
import { dayLabel } from "../thread/format";
import type { RawMessage } from "../thread/thread";
import { costText, fullTime, ownerTitle, tokenChips, typeOptions } from "./format";
import { useDebounced } from "./hooks";
import { RecordItem, type Entry } from "./RecordItem";
import { CostStat, Stat } from "./Stat";
import type { Owner, OwnersPage, RecordsPage, RecordType } from "./types";

const PAGE_SIZE = 100;

export function OwnerDetail() {
  const { kind = "", id = "" } = useParams();
  // 换一个对象时整体重建，筛选条件和已加载的记录不会串到下一个对象。
  return <DetailBody key={`${kind}/${id}`} kind={kind} id={id} />;
}

function DetailBody({ kind, id }: { kind: string; id: string }) {
  const [type, setType] = useState<RecordType>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<RecordsPage | null>(null);
  const [records, setRecords] = useState<RawMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<Owner[]>([]);
  const search = useDebounced(query.trim());
  const valid = kind === "session" || kind === "task";
  const route = (before = 0) =>
    `/api/logs/records?kind=${kind}&id=${encodeURIComponent(id)}&type=${type}&q=${encodeURIComponent(search)}&limit=${PAGE_SIZE}&before=${before}`;

  useEffect(() => {
    if (!valid) {
      return;
    }
    let current = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api.get<RecordsPage>(route());
        if (current) {
          setPage(result);
          setRecords(result.records);
          setHasMore(result.has_more);
          setError("");
        }
      } catch (failure) {
        if (current) {
          setError(failure instanceof Error ? failure.message : "读取失败");
        }
      } finally {
        if (current) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [type, search]);

  // 对话详情里列出它的子任务，方便逐个钻取。
  useEffect(() => {
    if (kind !== "session") {
      return;
    }
    let current = true;
    api
      .get<OwnersPage>(`/api/logs/owners?kind=task&parent=${encodeURIComponent(id)}&limit=50`)
      .then((result) => {
        if (current) {
          setTasks(result.owners);
        }
      })
      .catch(() => {
        /* 子任务列表只是辅助信息，读取失败不影响主体 */
      });
    return () => {
      current = false;
    };
  }, []);

  async function loadOlder() {
    if (records.length === 0 || loadingOlder) {
      return;
    }
    setLoadingOlder(true);
    try {
      const result = await api.get<RecordsPage>(route(records[0].id));
      setRecords((previous) => [...result.records, ...previous]);
      setHasMore(result.has_more);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "读取失败");
    } finally {
      setLoadingOlder(false);
    }
  }

  // 最新的在最前。压缩摘要按时间插进消息之间。
  const entries = useMemo(() => {
    const list: Entry[] = records.map((message) => ({
      kind: "message",
      key: `m${message.id}`,
      at: message.created_at ?? 0,
      order: message.id,
      message,
    }));
    for (const compaction of page?.compactions || []) {
      list.push({
        kind: "compaction",
        key: `c${compaction.id}`,
        at: compaction.created_at,
        order: compaction.id,
        compaction,
      });
    }
    return list.sort((a, b) => b.at - a.at || b.order - a.order);
  }, [records, page]);

  if (!valid) {
    return <p className="logs-note is-error">未知的类型</p>;
  }
  const owner = page?.owner;
  const summary = page?.summary;
  const filtered = type !== "all" || search !== "";
  let lastDay = "";

  return (
    <div className="logs-detail">
      {owner && summary ? (
        <div className="detail-head">
          <div className="detail-title-row">
            <h2 className="detail-title">{ownerTitle(owner)}</h2>
            <span className="kind-badge">{owner.kind === "session" ? "对话" : "子任务"}</span>
            {owner.status && (
              <span className={`kind-badge status-${owner.status}`}>
                {labels[owner.status] || owner.status}
              </span>
            )}
          </div>
          <p className="detail-meta">
            <span className="mono">{owner.id}</span>
            {owner.model && <span> · {owner.model}</span>}
            <span> · 创建 {fullTime(owner.created_at)}</span>
            <span> · 更新 {fullTime(owner.updated_at)}</span>
          </p>
          <div className="stat-grid">
            <CostStat
              label={owner.kind === "session" ? "对话自身费用" : "任务费用"}
              cost={summary.cost}
              requests={summary.requests}
            />
            {owner.kind === "session" && tasks.length > 0 && (
              <CostStat label="含子任务合计" cost={owner.cost} requests={owner.request_count} />
            )}
            <Stat label="模型请求" value={summary.requests.toLocaleString("en-US")} />
            <Stat label="记录条数" value={owner.message_count.toLocaleString("en-US")} />
          </div>
          {tokenChips(summary.tokens).length > 0 && (
            <div className="pill-row">
              {tokenChips(summary.tokens).map((chip) => (
                <span key={chip} className="detail-pill">
                  {chip}
                </span>
              ))}
            </div>
          )}
          {summary.models.length > 0 && (
            <div className="logs-models">
              {summary.models.map((model) => (
                <span key={model.model} className="logs-model-line">
                  <span className="mono">{model.model}</span>
                  <span>
                    {model.requests} 次 · {costText(model.cost, model.requests)}
                  </span>
                </span>
              ))}
            </div>
          )}
          <div className="detail-links">
            {owner.kind === "session" && (
              <Link to={`/sessions/${owner.id}`} className="detail-link">
                <Icon name="messages" size={14} />
                打开对话
              </Link>
            )}
            {owner.kind === "task" && owner.session_id && (
              <Link to={`/logs/session/${owner.session_id}`} className="detail-link">
                <Icon name="back" size={14} />
                所属对话：{owner.session_title || "未命名对话"}
              </Link>
            )}
            {tasks.map((task) => (
              <Link key={task.id} to={`/logs/task/${task.id}`} className="detail-link">
                <Icon name="terminal" size={14} />
                <span className="clip">{ownerTitle(task)}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="detail-head">
          <h2 className="detail-title">{error ? "无法读取" : "正在读取…"}</h2>
        </div>
      )}

      <div className="detail-toolbar">
        <div className="chip-group" role="group" aria-label="记录类型">
          {typeOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`filter-chip${type === item.value ? " selected" : ""}`}
              aria-pressed={type === item.value}
              onClick={() => setType(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="logs-search">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索记录"
            placeholder="搜索这一项里的内容"
          />
          {query && (
            <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="detail-body">
        {error && <p className="logs-note is-error">{error}</p>}
        {!error && !loading && entries.length === 0 && (
          <p className="logs-note">{filtered ? "没有匹配的记录" : "还没有任何记录"}</p>
        )}
        {entries.map((entry) => {
          const label = dayLabel(entry.at);
          const showDay = label !== "" && label !== lastDay;
          lastDay = label || lastDay;
          return (
            <div key={entry.key}>
              {showDay && <div className="log-day">{label}</div>}
              <RecordItem entry={entry} />
            </div>
          );
        })}
        {hasMore && (
          <button
            type="button"
            className="btn btn-quiet logs-more"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "正在读取…" : "加载更早的记录"}
          </button>
        )}
      </div>
    </div>
  );
}
