// 左侧栏,自上而下:品牌行 · 新对话 · 最近对话 · 底部(设置)。
// 行悬停露出操作(重命名 / 删除),正在跑的行画呼吸点。
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

import { Icon, Mark } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import {
  createDraft,
  removeThread,
  renameThread,
  threadTitle,
  useThread,
  type Thread,
} from "../thread/store";
import { useShell } from "./layout";

export function Sidebar() {
  const shell = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const { threads, currentId, busy } = useThread();
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [renameText, setRenameText] = useState("");
  const [removing, setRemoving] = useState<Thread | null>(null);

  useEffect(() => {
    if (renaming) {
      setRenameText(threadTitle(renaming));
    }
  }, [renaming]);

  const confirmRename = () => {
    const thread = renaming;
    setRenaming(null);
    if (!thread) {
      return;
    }
    const title = renameText.trim();
    if (title !== thread.title) {
      void renameThread(thread.id, title);
    }
  };

  const row = (thread: Thread) => {
    const live = thread.running || (thread.id === currentId && busy);
    return (
      <div
        key={thread.id}
        className={`conv${location.pathname === `/sessions/${thread.id}` ? " on" : ""}`}
      >
        {live && <span className="conv-live" title="正在运行" />}
        <Link className="conv-title clip" to={`/sessions/${thread.id}`} onClick={shell.closeDrawer}>
          {threadTitle(thread)}
        </Link>
        <span className="conv-ops" onClick={(event) => event.stopPropagation()}>
          <button className="op" title="重命名" onClick={() => setRenaming(thread)}>
            <Icon name="pen" size={13} />
          </button>
          <button className="op danger" title="删除" onClick={() => setRemoving(thread)}>
            <Icon name="trash" size={13} />
          </button>
        </span>
      </div>
    );
  };

  return (
    <>
      {shell.drawer && <div className="side-veil" onClick={shell.closeDrawer} />}

      <aside className={`sidebar${shell.collapsed ? " folded" : ""}${shell.drawer ? " open" : ""}`}>
        <div className="side-head">
          <Mark size={24} />
          <span className="side-brand">agentic</span>
          <span className="grow" />
          <button className="icon-btn fold-btn" title="收起侧栏" onClick={shell.toggleCollapsed}>
            <Icon name="panel" size={16} />
          </button>
        </div>

        {/* 新对话是动作不是清单的一行,恒在顶部,不进滚动区 */}
        <Link
          to="/"
          className="side-new"
          onClick={() => {
            shell.closeDrawer();
            if (location.pathname === "/") {
              createDraft();
            }
          }}
        >
          <Icon name="compose" size={16} />
          <span>新对话</span>
        </Link>

        <div className="side-scroll">
          {threads.length > 0 && (
            <>
              <div className="side-label">最近</div>
              {threads.map(row)}
            </>
          )}
          {!threads.length && <div className="side-empty">还没有对话</div>}
        </div>

        <div className="side-foot">
          <NavLink
            to="/settings"
            className={({ isActive }) => `side-settings${isActive ? " on" : ""}`}
            onClick={shell.closeDrawer}
          >
            <Icon name="settings" size={15} />
            <span>设置</span>
          </NavLink>
        </div>
      </aside>

      {renaming && (
        <Sheet title="重命名" onClose={() => setRenaming(null)}>
          <input
            className="field-input"
            value={renameText}
            autoFocus
            placeholder="对话标题"
            onChange={(event) => setRenameText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                confirmRename();
              }
            }}
          />
          <div className="sheet-foot">
            <button className="btn btn-quiet" onClick={() => setRenaming(null)}>
              取消
            </button>
            <button className="btn btn-accent" onClick={confirmRename}>
              保存
            </button>
          </div>
        </Sheet>
      )}

      {removing && (
        <Sheet title="删除" onClose={() => setRemoving(null)}>
          <div className="sheet-note">
            「{threadTitle(removing)}
            」的全部消息和压缩记录会一并删除,不可恢复。
          </div>
          <div className="sheet-foot">
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
              删除
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
