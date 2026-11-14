import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import {
  createDraft,
  isPinned,
  pinThread,
  setPinnedThreads,
  threadTitle,
  useThread,
  type Thread,
} from "../thread/store";
import { DeleteThreadSheet, RenameThreadSheet } from "../thread/ThreadDialogs";
import { ConversationRow } from "./ConversationRow";
import { PaneHead } from "./heads";
import { useShell } from "./layout";
import { useThreadDrag } from "./useThreadDrag";

function conversationGroup(updatedAt: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (updatedAt >= today.getTime()) {
    return "今天";
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return updatedAt >= yesterday.getTime() ? "昨天" : "更早";
}

// 对话应用的列表栏：搜索、新对话、置顶组和按时间分组的会话。
export function ChatPane() {
  const shell = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const { threads, currentId, busy } = useThread();
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [removing, setRemoving] = useState<Thread | null>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const query = search.trim().toLocaleLowerCase();
  // 置顶组与其余会话分开：置顶按服务端序号，其余按最近活动分「今天/昨天/更早」。
  const pinnedThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          isPinned(thread) && (!query || threadTitle(thread).toLocaleLowerCase().includes(query)),
      ),
    [threads, query],
  );
  const groups = useMemo(() => {
    const result: Array<{ label: string; threads: Thread[] }> = [];
    for (const thread of threads) {
      if (isPinned(thread)) {
        continue;
      }
      if (query && !threadTitle(thread).toLocaleLowerCase().includes(query)) {
        continue;
      }
      const label = conversationGroup(thread.updated_at);
      let group = result.find((item) => item.label === label);
      if (!group) {
        group = { label, threads: [] };
        result.push(group);
      }
      group.threads.push(thread);
    }
    return result;
  }, [threads, query]);
  const allPinnedIds = useMemo(
    () => threads.filter(isPinned).map((thread) => thread.id),
    [threads],
  );
  // 搜索过滤后的列表不是完整顺序，搜索时不允许拖拽。
  const drag = useThreadDrag({
    enabled: query === "",
    pinnedIds: allPinnedIds,
    onChange: (ids) => void setPinnedThreads(ids),
  });
  const renderRow = (thread: Thread) => (
    <ConversationRow
      key={thread.id}
      thread={thread}
      active={location.pathname === `/sessions/${thread.id}`}
      live={thread.running || (thread.id === currentId && busy)}
      pinned={isPinned(thread)}
      dragging={drag.draggingId === thread.id}
      gestures={drag.bind({ id: thread.id, title: threadTitle(thread) })}
      consumeClick={drag.consumeClick}
      onNavigate={shell.closeDrawer}
      onRename={setRenaming}
      onRemove={setRemoving}
      onTogglePin={(target) => void pinThread(target.id, !isPinned(target))}
      onMenuTrigger={(element) => {
        actionTrigger.current = element;
      }}
    />
  );
  return (
    <>
      <PaneHead title="对话" />
      <div className="pane-tools">
        <div className="search-field grow">
          <Icon name="search" size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索对话"
            placeholder="搜索对话"
          />
          {search && (
            <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        <Hint text="新对话">
          <Link
            to="/"
            className="compose-btn"
            aria-label="新对话"
            onClick={() => {
              shell.closeDrawer();
              if (location.pathname === "/") {
                createDraft();
              }
            }}
          >
            <Icon name="compose" size={17} />
          </Link>
        </Hint>
      </div>
      <nav className="pane-scroll side-scroll" aria-label="对话列表">
        {(pinnedThreads.length > 0 || drag.draggingId !== "") && (
          <div className="conversation-group" data-group="pinned">
            <div className="pane-label">置顶</div>
            {pinnedThreads.map(renderRow)}
            {pinnedThreads.length === 0 && <div className="pin-empty">拖到这里置顶</div>}
          </div>
        )}
        <div data-group="recent">
          {groups.map((group) => (
            <div className="conversation-group" key={group.label}>
              <div className="pane-label">{group.label}</div>
              {group.threads.map(renderRow)}
            </div>
          ))}
        </div>
        {!groups.length && !pinnedThreads.length && (
          <div className="empty">
            <Icon name={search ? "search" : "messages"} size={22} />
            <span>{search ? "没有匹配的对话" : "还没有对话"}</span>
          </div>
        )}
      </nav>
      {renaming && (
        <RenameThreadSheet
          thread={renaming}
          returnFocus={actionTrigger.current}
          onClose={() => setRenaming(null)}
        />
      )}
      {removing && (
        <DeleteThreadSheet
          thread={removing}
          returnFocus={actionTrigger.current}
          onClose={() => setRemoving(null)}
          onDeleted={(id) => {
            if (window.location.pathname === `/sessions/${id}`) {
              navigate("/", { replace: true });
            }
          }}
        />
      )}
    </>
  );
}
