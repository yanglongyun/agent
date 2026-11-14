import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Icon } from "../icons/Icon";
import { api } from "../lib/api";
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
  return `对话 · ${owner.message_count} 条消息 · ${owner.request_count} 次请求`;
}

export function OwnerList({
  selectedId,
  overviewSelected,
}: {
  selectedId?: string;
  overviewSelected: boolean;
}) {
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
    <aside className="logs-list" aria-label="对话和任务">
      <div className="logs-list-head">
        <div className="logs-search">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索日志"
            placeholder="搜索标题或消息内容"
          />
          {query && (
            <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        <div className="chip-group" role="group" aria-label="类型">
          {kinds.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`filter-chip${kind === item.value ? " selected" : ""}`}
              aria-pressed={kind === item.value}
              onClick={() => setKind(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="logs-owner-scroll">
        <Link
          to="/logs/overview"
          className={`owner-row overview-row${overviewSelected ? " on" : ""}`}
        >
          <span className="owner-main">
            <span className="owner-title">用量总览</span>
            <span className="owner-sub">全部对话和子任务的 token 与费用</span>
          </span>
          <Icon name="chev" size={15} />
        </Link>
        {error && <p className="logs-note is-error">{error}</p>}
        {loading && owners.length === 0 && <p className="logs-note">正在读取…</p>}
        {!loading && !error && owners.length === 0 && (
          <p className="logs-note">没有匹配的对话或任务</p>
        )}
        {owners.map((owner) => (
          <Link
            key={`${owner.kind}:${owner.id}`}
            to={`/logs/${owner.kind}/${owner.id}`}
            className={`owner-row${selectedId === owner.id ? " on" : ""}`}
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
            className="btn btn-quiet logs-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "正在读取…" : "加载更多"}
          </button>
        )}
      </div>
    </aside>
  );
}
