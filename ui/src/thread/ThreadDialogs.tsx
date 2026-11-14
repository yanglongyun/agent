import { useState } from "react";
import { Sheet } from "../overlay/Sheet";
import { removeThread, renameThread, threadTitle, type Thread } from "./store";

// 重命名和删除对话的确认弹窗。列表栏的行菜单和对话顶栏的菜单共用同一份。
export function RenameThreadSheet({
  thread,
  returnFocus,
  onClose,
}: {
  thread: Thread;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(threadTitle(thread));
  const confirm = () => {
    const next = title.trim();
    onClose();
    if (next && next !== thread.title) {
      void renameThread(thread.id, next);
    }
  };
  return (
    <Sheet
      title="重命名对话"
      returnFocus={returnFocus}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={!title.trim()}
            onClick={confirm}
          >
            保存
          </button>
        </>
      }
    >
      <label className="field">
        对话标题
        <input
          className="field-input"
          value={title}
          data-autofocus
          placeholder="输入对话标题"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && title.trim()) {
              confirm();
            }
          }}
        />
      </label>
    </Sheet>
  );
}

export function DeleteThreadSheet({
  thread,
  returnFocus,
  onClose,
  onDeleted,
}: {
  thread: Thread;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    if (deleting) {
      return;
    }
    setDeleting(true);
    const removed = await removeThread(thread.id);
    setDeleting(false);
    if (removed) {
      onClose();
      onDeleted(thread.id);
    }
  };
  return (
    <Sheet
      title="删除对话"
      returnFocus={returnFocus}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleting}
            onClick={() => void confirm()}
          >
            {deleting ? "正在删除…" : "删除对话"}
          </button>
        </>
      }
    >
      <p className="dialog-description">
        将删除「{threadTitle(thread)}」及其中的消息和附件。此操作无法撤销。
      </p>
    </Sheet>
  );
}
