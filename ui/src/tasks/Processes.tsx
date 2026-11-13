import { useEffect, useState } from "react";
import { labels, active } from "./status";
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
      className="task-detail"
      onClose={onClose}
      footer={
        <>
          <span className={`task-state ${record?.status || ""}`}>
            {record ? labels[record.status] : "正在读取…"}
          </span>
          {running && (
            <button
              type="button"
              className="btn btn-quiet task-stop"
              disabled={pending || record.status === "cancelling"}
              onClick={() => void act("cancel")}
            >
              停止命令
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      {(readError || error) && <p className="sheet-error">{readError || error}</p>}
      {record && (
        <>
          <pre className="process-command">{record.command}</pre>
          <div className="task-facts">
            <span>工作目录：{record.workdir}</span>
            {record.exit_code !== null && <span>退出码 {record.exit_code}</span>}
          </div>
          {record.error && <p className="sheet-error">{record.error}</p>}
          {record.truncated > 0 && <p className="sheet-note">输出过长，显示末尾内容。</p>}
          <pre className="process-output" aria-label="命令输出">
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
              <label htmlFor="process-input">发送输入</label>
              <textarea
                id="process-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="输入内容，发送时追加换行"
                rows={2}
                disabled={pending}
              />
              <div>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={pending}
                  onClick={() => void act("close")}
                >
                  结束输入
                </button>
                <button type="submit" className="btn btn-quiet" disabled={pending}>
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
