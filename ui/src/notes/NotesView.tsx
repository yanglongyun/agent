// 记事本舞台：标题 + 正文，输入停顿后自动保存，离开前补存未提交的改动。
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Icon } from "../icons/Icon";
import { api } from "../lib/api";
import { Sheet } from "../overlay/Sheet";
import { StageHead } from "../shell/heads";
import { noteTime, noteTitle } from "./format";
import { useNotes } from "./store";
import type { Note } from "./types";

export function NotesView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const create = useNotes((state) => state.create);
  const remove = useNotes((state) => state.remove);
  const touch = useNotes((state) => state.touch);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [saveError, setSaveError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [reload, setReload] = useState(0);
  const loadedId = useRef("");
  const saved = useRef({ title: "", body: "" });
  const pending = useRef<{ id: string; title: string; body: string } | null>(null);

  async function persist(targetId: string, nextTitle: string, nextBody: string) {
    pending.current = null;
    try {
      const note = await api.put<Note>(`/api/notes/${targetId}`, {
        title: nextTitle,
        body: nextBody,
      });
      touch(note);
      if (loadedId.current !== targetId) {
        return;
      }
      saved.current = { title: note.title, body: note.body };
      setUpdatedAt(note.updated_at);
      setSaveState("saved");
      setSaveError("");
    } catch (failure) {
      pending.current = { id: targetId, title: nextTitle, body: nextBody };
      if (loadedId.current !== targetId) {
        return;
      }
      setSaveState("failed");
      setSaveError(failure instanceof Error ? failure.message : "保存失败");
    }
  }

  useEffect(() => {
    if (!id) {
      return;
    }
    let current = true;
    loadedId.current = "";
    pending.current = null;
    setLoading(true);
    setLoadError("");
    setSaveState("saved");
    setSaveError("");
    async function open() {
      try {
        const note = await api.get<Note>(`/api/notes/${id}`);
        if (!current) {
          return;
        }
        loadedId.current = note.id;
        saved.current = { title: note.title, body: note.body };
        setTitle(note.title);
        setBody(note.body);
        setUpdatedAt(note.updated_at);
      } catch (failure) {
        if (current) {
          setLoadError(failure instanceof Error ? failure.message : "读取失败");
        }
      } finally {
        if (current) {
          setLoading(false);
        }
      }
    }
    void open();
    return () => {
      current = false;
      // 切到别的笔记或离开页面后，迟到的保存结果不再写回界面状态。
      loadedId.current = "";
    };
  }, [id, reload]);

  useEffect(() => {
    if (!id || loadedId.current !== id) {
      return;
    }
    if (title === saved.current.title && body === saved.current.body) {
      pending.current = null;
      return;
    }
    pending.current = { id, title, body };
    setSaveState("saving");
    const timer = setTimeout(() => void persist(id, title, body), 600);
    return () => clearTimeout(timer);
  }, [id, title, body]);

  // 切换笔记或离开页面时，防抖窗口里剩下的改动直接补存一次。
  useEffect(() => {
    return () => {
      const draft = pending.current;
      if (draft) {
        void persist(draft.id, draft.title, draft.body);
      }
    };
  }, [id]);

  async function startNote() {
    try {
      const note = await create();
      navigate(`/notes/${note.id}`);
    } catch (failure) {
      setSaveState("failed");
      setSaveError(failure instanceof Error ? failure.message : "新建失败");
    }
  }

  async function confirmRemove() {
    if (!id) {
      return;
    }
    pending.current = null;
    try {
      await remove(id);
      setRemoving(false);
      navigate("/notes");
    } catch (failure) {
      setRemoving(false);
      setSaveState("failed");
      setSaveError(failure instanceof Error ? failure.message : "删除失败");
    }
  }

  if (!id) {
    return (
      <section className="stage">
        <StageHead title="记事本" />
        <main className="stage-scroll">
          <div className="notes-blank">
            <div className="empty">
              <Icon name="notes" size={24} />
              <strong>选择一篇笔记</strong>
              <span>在左侧打开已有笔记，或者新建一篇。</span>
              <button type="button" className="btn btn-accent sm" onClick={() => void startNote()}>
                <Icon name="plus" size={15} />
                新建笔记
              </button>
            </div>
          </div>
        </main>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="stage">
        <StageHead title="记事本" />
        <main className="route-error">
          <Icon name="alert" size={28} />
          <h2>暂时无法打开这篇笔记</h2>
          <p>{loadError}</p>
          <div className="route-error-actions">
            <button type="button" className="btn btn-accent" onClick={() => setReload(reload + 1)}>
              重试
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => navigate("/notes")}>
              返回记事本
            </button>
          </div>
        </main>
      </section>
    );
  }

  return (
    <section className="stage">
      <StageHead title={noteTitle({ title })}>
        {saveState === "saving" && (
          <span className="badge is-accent is-live" role="status">
            保存中
          </span>
        )}
        {saveState === "failed" && (
          <span className="badge is-danger" role="status">
            未保存
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label="删除笔记"
          onClick={() => setRemoving(true)}
        >
          <Icon name="trash" size={17} />
        </button>
      </StageHead>
      <main className="stage-scroll">
        {loading ? (
          <p className="note">正在读取…</p>
        ) : (
          <div className="note-page">
            <input
              className="note-title"
              value={title}
              placeholder="标题"
              aria-label="笔记标题"
              onChange={(event) => setTitle(event.target.value)}
            />
            <textarea
              className="note-body"
              value={body}
              placeholder="开始写…"
              aria-label="笔记正文"
              spellCheck={false}
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="note-status">
              {saveError ? (
                <span className="is-error">{saveError}</span>
              ) : (
                updatedAt > 0 && `最后保存 ${noteTime(updatedAt)}`
              )}
              <span>{body.length} 字符</span>
            </p>
          </div>
        )}
      </main>
      {removing && (
        <Sheet
          title="删除笔记"
          onClose={() => setRemoving(false)}
          footer={
            <>
              <button type="button" className="btn btn-quiet" onClick={() => setRemoving(false)}>
                取消
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void confirmRemove()}>
                删除笔记
              </button>
            </>
          }
        >
          <p className="dialog-description">将删除「{noteTitle({ title })}」。此操作无法撤销。</p>
        </Sheet>
      )}
    </section>
  );
}
