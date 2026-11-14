import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Icon } from "../icons/Icon";
import { api } from "../lib/api";
import { StageHead } from "../shell/heads";
import { labels, statusTone } from "../tasks/status";
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
    return (
      <section className="stage">
        <StageHead title="日志" />
        <p className="note is-error">未知的类型</p>
      </section>
    );
  }
  const owner = page?.owner;
  const summary = page?.summary;
  const filtered = type !== "all" || search !== "";
  const chips = summary ? tokenChips(summary.tokens) : [];
  let lastDay = "";
  let title = "正在读取…";
  if (owner) {
    title = ownerTitle(owner);
  } else if (error) {
    title = "无法读取";
  }

  return (
    <section className="stage">
      <StageHead
        title={title}
        meta={
          owner && (
            <>
              <span className="badge is-accent">
                {owner.kind === "session" ? "对话" : "子任务"}
              </span>
              {owner.status && (
                <span className={`badge ${statusTone(owner.status)}`}>
                  {labels[owner.status] || owner.status}
                </span>
              )}
            </>
          )
        }
      >
        {owner?.kind === "session" && (
          <Link to={`/sessions/${owner.id}`} className="btn btn-quiet sm">
            <Icon name="messages" size={14} />
            打开对话
          </Link>
        )}
        {owner?.kind === "task" && owner.session_id && (
          <Link to={`/logs/session/${owner.session_id}`} className="btn btn-quiet sm">
            <Icon name="back" size={14} />
            所属对话
          </Link>
        )}
      </StageHead>
      <main className="stage-scroll">
        <div className="page">
          {owner && summary && (
            <>
              <p className="detail-meta">
                <span className="mono">{owner.id}</span>
                {owner.model && <span>{owner.model}</span>}
                <span>创建于 {fullTime(owner.created_at)}</span>
                <span>更新于 {fullTime(owner.updated_at)}</span>
              </p>
              <div className="stat-grid">
                <CostStat
                  label={owner.kind === "session" ? "对话自身费用" : "任务费用"}
                  cost={summary.cost}
                  requests={summary.requests}
                  accent
                />
                {owner.kind === "session" && tasks.length > 0 && (
                  <CostStat label="含子任务合计" cost={owner.cost} requests={owner.request_count} />
                )}
                <Stat label="模型请求" value={summary.requests.toLocaleString("en-US")} />
                <Stat label="记录条数" value={owner.message_count.toLocaleString("en-US")} />
              </div>
              {(chips.length > 0 || summary.models.length > 0) && (
                <div className="card usage-card">
                  {chips.length > 0 && (
                    <div className="usage-row">
                      <div className="pill-row">
                        {chips.map((chip) => (
                          <span key={chip} className="pill">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {summary.models.map((model) => (
                    <div key={model.model} className="usage-row">
                      <div className="usage-row-head">
                        <b className="mono">{model.model}</b>
                        <span className="usage-row-count">{model.requests} 次请求</span>
                        <span className="usage-row-cost">
                          {costText(model.cost, model.requests)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tasks.length > 0 && (
                <section className="logs-section">
                  <h3>子任务 · {tasks.length}</h3>
                  <div className="card usage-card">
                    {tasks.map((task) => (
                      <Link key={task.id} to={`/logs/task/${task.id}`} className="task-link">
                        <Icon name="bot" size={15} />
                        <span className="clip grow">{ownerTitle(task)}</span>
                        {task.status && (
                          <span className={`badge ${statusTone(task.status)}`}>
                            {labels[task.status] || task.status}
                          </span>
                        )}
                        <Icon name="chev" size={14} />
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <div className="detail-toolbar">
            <div className="seg" role="group" aria-label="记录类型">
              {typeOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`seg-item${type === item.value ? " selected" : ""}`}
                  aria-pressed={type === item.value}
                  onClick={() => setType(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="search-field">
              <Icon name="search" size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索记录"
                placeholder="搜索这一项里的内容"
              />
              {query && (
                <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="record-list">
            {error && <p className="note is-error">{error}</p>}
            {!error && loading && entries.length === 0 && <p className="note">正在读取…</p>}
            {!error && !loading && entries.length === 0 && (
              <div className="empty">
                <Icon name="logs" size={24} />
                <strong>{filtered ? "没有匹配的记录" : "还没有任何记录"}</strong>
              </div>
            )}
            {entries.map((entry) => {
              const label = dayLabel(entry.at);
              const showDay = label !== "" && label !== lastDay;
              lastDay = label || lastDay;
              return (
                <div key={entry.key} className="record-slot">
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
      </main>
    </section>
  );
}
