import { useEffect, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { PaneHead } from "../shell/heads";
import { useShell } from "../shell/layout";
import { noteTime, noteTitle } from "./format";
import { useNotes } from "./store";

// 记事本应用的列表栏：搜索、新建和按最近修改排序的笔记。
export function NotesPane() {
  const detail = useMatch("/notes/:id");
  const selectedId = detail?.params.id;
  const navigate = useNavigate();
  const closeDrawer = useShell((state) => state.closeDrawer);
  const { notes, loading, loaded, error, load, create } = useNotes();
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const visible = notes.filter((note) => {
    if (!search) {
      return true;
    }
    return (
      noteTitle(note).toLocaleLowerCase().includes(search) ||
      note.preview.toLocaleLowerCase().includes(search)
    );
  });

  useEffect(() => {
    void load();
  }, [load]);

  async function startNote() {
    setActionError("");
    try {
      const note = await create();
      closeDrawer();
      navigate(`/notes/${note.id}`);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : "新建失败");
    }
  }

  return (
    <>
      <PaneHead title="记事本" />
      <div className="pane-tools">
        <div className="search-field grow">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索笔记"
            placeholder="搜索笔记"
          />
          {query && (
            <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
        <Hint text="新建笔记">
          <button
            type="button"
            className="compose-btn"
            aria-label="新建笔记"
            onClick={() => void startNote()}
          >
            <Icon name="compose" size={17} />
          </button>
        </Hint>
      </div>
      <nav className="pane-scroll" aria-label="笔记列表">
        {error && <p className="note is-error">{error}</p>}
        {actionError && <p className="note is-error">{actionError}</p>}
        {loading && notes.length === 0 && <p className="note">正在读取…</p>}
        {loaded && !error && notes.length === 0 && (
          <div className="empty">
            <Icon name="notes" size={22} />
            <span>还没有笔记</span>
          </div>
        )}
        {notes.length > 0 && visible.length === 0 && <p className="note">没有匹配的笔记</p>}
        {visible.map((note) => (
          <Link
            key={note.id}
            to={`/notes/${note.id}`}
            className={`row note-row${selectedId === note.id ? " on" : ""}`}
            onClick={closeDrawer}
          >
            <span className="note-row-main">
              <span className="note-row-title clip">{noteTitle(note)}</span>
              <span className="note-row-preview clip">{note.preview || "空白笔记"}</span>
            </span>
            <span className="note-row-time">{noteTime(note.updated_at)}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
