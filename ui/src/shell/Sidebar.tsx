import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { Icon, type IconName } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { Sheet } from "../overlay/Sheet";
import { cycleTheme, useTheme } from "../lib/theme";
import {
  createDraft,
  removeThread,
  renameThread,
  threadTitle,
  useThread,
  type Thread,
} from "../thread/store";
import { useShell } from "./layout";

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
  const theme = useTheme((state) => state.mode);
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [renameText, setRenameText] = useState("");
  const [removing, setRemoving] = useState<Thread | null>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(() => {
    const result: Array<{ label: string; threads: Thread[] }> = [];
    const query = search.trim().toLocaleLowerCase();
    for (const thread of threads) {
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
  }, [threads, search]);
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
  const themeNames = { auto: "跟随系统", light: "浅色", dark: "深色" };
  const themeIcons: Record<typeof theme, IconName> = {
    auto: "monitor",
    light: "sun",
    dark: "moon",
  };
  const content = (
    <>
      <div className="side-head">
        <span className="side-brand">聊天</span>
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
        {groups.map((group) => (
          <div className="conversation-group" key={group.label}>
            <div className="side-label">
              {group.label}
              <span>{group.threads.length}</span>
            </div>
            {group.threads.map((thread) => {
              const live = thread.running || (thread.id === currentId && busy);
              return (
                <div
                  key={thread.id}
                  className={`conv${location.pathname === `/sessions/${thread.id}` ? " on" : ""}`}
                >
                  <Link
                    className="conv-title"
                    to={`/sessions/${thread.id}`}
                    onClick={shell.closeDrawer}
                    title={threadTitle(thread)}
                  >
                    {live && <span className="conv-live" aria-label="正在运行" />}
                    <span className="clip">{threadTitle(thread)}</span>
                  </Link>
                  <Dropdown.Root>
                    <Dropdown.Trigger
                      className="conv-menu icon-btn"
                      onFocus={(event) => {
                        actionTrigger.current = event.currentTarget;
                      }}
                      onPointerDown={(event) => {
                        actionTrigger.current = event.currentTarget;
                      }}
                      aria-label={`对话操作：${threadTitle(thread)}`}
                    >
                      <Icon name="more" size={17} />
                    </Dropdown.Trigger>
                    <Dropdown.Portal>
                      <Dropdown.Content
                        className="dropdown-content"
                        align="start"
                        side="right"
                        sideOffset={8}
                        collisionPadding={12}
                      >
                        <Dropdown.Item
                          className="dropdown-item"
                          onSelect={() => setRenaming(thread)}
                        >
                          <Icon name="pen" size={15} />
                          重命名
                        </Dropdown.Item>
                        <Dropdown.Separator className="dropdown-separator" />
                        <Dropdown.Item
                          className="dropdown-item danger"
                          onSelect={() => setRemoving(thread)}
                        >
                          <Icon name="trash" size={15} />
                          删除对话
                        </Dropdown.Item>
                      </Dropdown.Content>
                    </Dropdown.Portal>
                  </Dropdown.Root>
                </div>
              );
            })}
          </div>
        ))}
        {!groups.length && (
          <div className="side-empty">
            <Icon name={search ? "search" : "messages"} size={22} />
            <span>{search ? "没有匹配的对话" : "还没有对话"}</span>
          </div>
        )}
      </nav>
      <div className="side-foot">
        <NavLink
          to="/settings"
          className={({ isActive }) => `side-settings${isActive ? " on" : ""}`}
          onClick={shell.closeDrawer}
        >
          <Icon name="settings" size={17} />
          <span>设置</span>
        </NavLink>
        <Hint text={`主题：${themeNames[theme]}`}>
          <button
            className="icon-btn"
            aria-label={`切换主题，当前${themeNames[theme]}`}
            onClick={cycleTheme}
          >
            <Icon name={themeIcons[theme]} size={17} />
          </button>
        </Hint>
      </div>
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
