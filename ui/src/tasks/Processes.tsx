import { useEffect, useState } from "react";
import { labels, active, statusTone } from "./status";
import { Sheet } from "../overlay/Sheet";
import { api } from "../lib/api";

export interface ShellJob {
  id: string;
  task_id: string | null;
  command: string;
  workdir: string;
  status: string;
  output?: string;
  truncated: number;
  stdin_closed: number;
  exit_code: number | null;
  error: string | null;
  created_at: number;
}

export function ProcessDetail({
  processId,
  onClose,
  onChanged,
}: {
  processId: string;
  onClose: () => void;
  onChanged: (record: ShellJob) => void;
}) {
  const [record, setRecord] = useState<ShellJob | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await api.get<ShellJob>(`/api/processes/${processId}`);
        if (!current) {
          return;
        }
        setRecord(result);
        setReadError("");
        if (active(result)) {
          timer = setTimeout(() => void load(), 1500);
        }
      } catch (failure) {
        if (current) {
          setReadError(failure instanceof Error ? failure.message : "命令读取失败");
          timer = setTimeout(() => void load(), 3000);
        }
      }
    }
    void load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [processId]);
  const running = record && active(record);
  async function act(action: "write" | "close" | "cancel") {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      const updated = await api.post<ShellJob>(`/api/processes/${processId}/stdio`, {
        action,
        ...(action === "write" ? { input: input + "\n" } : {}),
      });
      setRecord(updated);
      onChanged(updated);
      setError("");
      if (action === "write") {
        setInput("");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <Sheet
      title="后台命令"
      className="xwide"
      onClose={onClose}
      footer={
        running ? (
          <button
            type="button"
            className="btn btn-danger-quiet"
            disabled={pending || record.status === "cancelling"}
            onClick={() => void act("cancel")}
          >
            停止命令
          </button>
        ) : undefined
      }
    >
      {(readError || error) && <p className="sheet-error">{readError || error}</p>}
      {!record && !readError && <p className="note">正在读取…</p>}
      {record && (
        <>
          <div className="task-brief">
            <pre className="well process-command">{record.command}</pre>
            <div className="pill-row">
              <span className={`badge ${statusTone(record.status)}`}>{labels[record.status]}</span>
              <span className="pill mono">{record.workdir}</span>
              {record.exit_code !== null && <span className="pill">退出码 {record.exit_code}</span>}
            </div>
          </div>
          {record.error && <p className="sheet-error">{record.error}</p>}
          <div className="process-label">
            <span>输出</span>
            {record.truncated > 0 && <small>输出过长，只显示末尾</small>}
          </div>
          <pre className="well process-output" aria-label="命令输出">
            {record.output || "暂无输出"}
          </pre>
          {running && !record.stdin_closed && (
            <form
              className="process-input"
              onSubmit={(event) => {
                event.preventDefault();
                void act("write");
              }}
            >
              <label className="field" htmlFor="process-input">
                发送输入
              </label>
              <textarea
                id="process-input"
                className="field-input mono"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="输入内容，发送时追加换行"
                rows={2}
                disabled={pending}
              />
              <div>
                <button
                  type="button"
                  className="btn btn-ghost sm"
                  disabled={pending}
                  onClick={() => void act("close")}
                >
                  结束输入
                </button>
                <button type="submit" className="btn btn-quiet sm" disabled={pending}>
                  发送
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </Sheet>
  );
}
