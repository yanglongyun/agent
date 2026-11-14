import { useEffect, useState } from "react";
import { Link, useMatch } from "react-router";
import { Icon } from "../icons/Icon";
import { api } from "../lib/api";
import { PaneHead } from "../shell/heads";
import { useShell } from "../shell/layout";
import { labels } from "../tasks/status";
import { costShort, listTime, ownerTitle } from "./format";
import { useDebounced } from "./hooks";
import type { Owner, OwnersPage } from "./types";

type Kind = "all" | "session" | "task";
const kinds: Array<{ value: Kind; label: string }> = [
  { value: "all", label: "全部" },
  { value: "session", label: "对话" },
  { value: "task", label: "子任务" },
];
const PAGE_SIZE = 50;

function subtitle(owner: Owner) {
  if (owner.kind === "task") {
    const parts = ["子任务"];
    if (owner.model) {
      parts.push(owner.model);
    }
    if (owner.status) {
      parts.push(labels[owner.status] || owner.status);
    }
    return parts.join(" · ");
  }
  return `${owner.message_count} 条消息 · ${owner.request_count} 次请求`;
}

// 日志应用的列表栏：用量总览入口 + 全部对话和子任务，可搜索、按类型筛选。
export function LogsPane() {
  const detail = useMatch("/logs/:kind/:id");
  const selectedId = detail?.params.id;
  const closeDrawer = useShell((state) => state.closeDrawer);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const search = useDebounced(query.trim());
  const route = (before = 0) =>
    `/api/logs/owners?kind=${kind}&q=${encodeURIComponent(search)}&limit=${PAGE_SIZE}&before=${before}`;

  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true);
      try {
        const page = await api.get<OwnersPage>(route());
        if (current) {
          setOwners(page.owners);
          setHasMore(page.has_more);
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
  }, [kind, search]);

  async function loadMore() {
    const last = owners[owners.length - 1];
    if (!last || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await api.get<OwnersPage>(route(last.updated_at));
      setOwners((previous) => {
        const known = new Set(previous.map((owner) => `${owner.kind}:${owner.id}`));
        return [
          ...previous,
          ...page.owners.filter((owner) => !known.has(`${owner.kind}:${owner.id}`)),
        ];
      });
      setHasMore(page.has_more);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "读取失败");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <PaneHead title="日志" />
      <div className="pane-tools">
        <div className="search-field">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索日志"
            placeholder="搜索标题或消息内容"
          />
          {query && (
            <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        <div className="seg fill" role="group" aria-label="类型">
          {kinds.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`seg-item${kind === item.value ? " selected" : ""}`}
              aria-pressed={kind === item.value}
              onClick={() => setKind(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <nav className="pane-scroll" aria-label="对话和任务">
        <Link to="/logs/overview" className={`row${detail ? "" : " on"}`} onClick={closeDrawer}>
          <Icon name="chart" size={16} />
          用量总览
        </Link>
        <div className="pane-label">对话与子任务</div>
        {error && <p className="note is-error">{error}</p>}
        {loading && owners.length === 0 && <p className="note">正在读取…</p>}
        {!loading && !error && owners.length === 0 && <p className="note">没有匹配的对话或任务</p>}
        {owners.map((owner) => (
          <Link
            key={`${owner.kind}:${owner.id}`}
            to={`/logs/${owner.kind}/${owner.id}`}
            className={`row owner-row${selectedId === owner.id ? " on" : ""}`}
            onClick={closeDrawer}
          >
            <span className="owner-main">
              <span className="owner-title clip">{ownerTitle(owner)}</span>
              <span className="owner-sub clip">{subtitle(owner)}</span>
            </span>
            <span className="owner-side">
              <span className="owner-cost">{costShort(owner.cost, owner.request_count)}</span>
              <span className="owner-time">{listTime(owner.updated_at)}</span>
            </span>
          </Link>
        ))}
        {hasMore && (
          <button
            type="button"
            className="btn btn-quiet sm logs-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "正在读取…" : "加载更多"}
          </button>
        )}
      </nav>
    </>
  );
}
