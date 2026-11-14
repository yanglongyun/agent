import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation, useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { Sheet } from "../overlay/Sheet";
import {
  createDraft,
  isPinned,
  pinThread,
  removeThread,
  renameThread,
  setPinnedThreads,
  threadTitle,
  useThread,
  type Thread,
} from "../thread/store";
import { ConversationRow } from "./ConversationRow";
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

export function Sidebar() {
  const shell = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const { threads, currentId, busy } = useThread();
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [renameText, setRenameText] = useState("");
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
  useEffect(() => {
    if (renaming) {
      setRenameText(threadTitle(renaming));
    }
  }, [renaming]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const close = () => {
      if (!media.matches) {
        useShell.getState().closeDrawer();
      }
    };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  const confirmRename = () => {
    const thread = renaming;
    setRenaming(null);
    if (thread && renameText.trim() !== thread.title) {
      void renameThread(thread.id, renameText.trim());
    }
  };
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
  const content = (
    <>
      <div className="side-head">
        <span className="side-brand">对话</span>
        <span className="grow" />
        <Hint text="新对话">
          <Link
            to="/"
            className="icon-btn side-compose"
            aria-label="新对话"
            onClick={() => {
              shell.closeDrawer();
              if (location.pathname === "/") {
                createDraft();
              }
            }}
          >
            <Icon name="compose" size={18} />
          </Link>
        </Hint>
        {shell.drawer ? (
          <button
            className="icon-btn side-toggle"
            aria-label="关闭导航"
            onClick={shell.closeDrawer}
          >
            <Icon name="close" size={18} />
          </button>
        ) : (
          <Hint text="收起侧栏">
            <button
              className="icon-btn side-toggle"
              aria-label="收起侧栏"
              onClick={shell.toggleCollapsed}
            >
              <Icon name="panel" size={18} />
            </button>
          </Hint>
        )}
      </div>
      <div className="side-search">
        <Icon name="search" size={15} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="搜索对话"
          placeholder="搜索对话"
        />
        {search && (
          <button aria-label="清除搜索" onClick={() => setSearch("")}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
      <nav className="side-scroll" aria-label="对话列表">
        {(pinnedThreads.length > 0 || drag.draggingId !== "") && (
          <div className="conversation-group" data-group="pinned">
            <div className="side-label">
              置顶
              <span>{pinnedThreads.length}</span>
            </div>
            {pinnedThreads.map(renderRow)}
            {pinnedThreads.length === 0 && <div className="pin-empty">拖到这里置顶</div>}
          </div>
        )}
        <div data-group="recent">
          {groups.map((group) => (
            <div className="conversation-group" key={group.label}>
              <div className="side-label">
                {group.label}
                <span>{group.threads.length}</span>
              </div>
              {group.threads.map(renderRow)}
            </div>
          ))}
        </div>
        {!groups.length && !pinnedThreads.length && (
          <div className="side-empty">
            <Icon name={search ? "search" : "messages"} size={22} />
            <span>{search ? "没有匹配的对话" : "还没有对话"}</span>
          </div>
        )}
      </nav>
    </>
  );
  return (
    <>
      <aside className={`sidebar${shell.collapsed ? " folded" : ""}`}>{content}</aside>
      <Dialog.Root
        open={shell.drawer}
        onOpenChange={(open) => {
          if (!open) {
            shell.closeDrawer();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="side-veil" />
          <Dialog.Content
            className="sidebar sidebar-dialog"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.querySelector<HTMLButtonElement>(".menu-btn")?.focus();
            }}
          >
            <Dialog.Title className="sr-only">工作区导航</Dialog.Title>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {renaming && (
        <Sheet
          title="重命名对话"
          returnFocus={actionTrigger.current}
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button className="btn btn-accent" onClick={confirmRename}>
                保存名称
              </button>
            </>
          }
        >
          <label className="dialog-field">
            对话标题
            <input
              className="field-input"
              value={renameText}
              data-autofocus
              placeholder="输入对话标题"
              onChange={(event) => setRenameText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  confirmRename();
                }
              }}
            />
          </label>
        </Sheet>
      )}
      {removing && (
        <Sheet
          title="删除对话"
          returnFocus={actionTrigger.current}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setRemoving(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const target = removing;
                  setRemoving(null);
                  const deleted = await removeThread(target.id);
                  if (deleted && window.location.pathname === `/sessions/${target.id}`) {
                    navigate("/", { replace: true });
                  }
                }}
              >
                删除对话
              </button>
            </>
          }
        >
          <p className="dialog-description">
            将删除「{threadTitle(removing)}」及其中的消息和附件。此操作无法撤销。
          </p>
        </Sheet>
      )}
    </>
  );
}
