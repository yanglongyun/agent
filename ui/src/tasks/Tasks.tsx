import { useEffect, useRef, useState } from "react";
import { labels, active, statusTone } from "./status";
import { ProcessDetail } from "./Processes";
import { Dialog } from "@/overlay/Dialog";
import { api } from "@/lib/api";
import { Icon } from "@/icons/Icon";
import { useT } from "@/i18n";
import { renderMd } from "@/chat/format";
import { projectRows } from "@/chat/store";
import { ThinkItem, ToolItem } from "@/chat/Process";
import { isImage } from "@/chat/attachments";
import { AttachmentImage } from "@/chat/AttachmentImage";
import { mergeMessages, type RawMessage, type Compaction } from "@/thread/thread";
import { costLabel } from "@/thread/metering";
import type { SessionActivity, Task } from "./activity";

// 后台任务（子 Agent）与后台命令各是一个独立弹窗，由标题栏菜单的入口分别打开。
export function TasksDialog({
  kind,
  activity,
  onClose,
}: {
  kind: "agent" | "shell";
  activity: SessionActivity;
  onClose: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<{ id: string; kind: "agent" | "shell" } | null>(null);
  const { tasks, processes, error, totalCost, updateTask, updateProcess } = activity;
  const agent = kind === "agent";
  const count = agent ? tasks.length : processes.length;
  const runningCount = agent ? tasks.filter(active).length : processes.filter(active).length;
  let subtitle = "";
  if (count > 0) {
    const statusText =
      runningCount > 0 ? t("tasks.running", { n: runningCount }) : t("tasks.allFinished");
    subtitle = agent ? `${statusText} · ${costLabel(totalCost)}` : statusText;
  }

  return (
    <>
      <Dialog
        title={agent ? t("tasks.title") : t("processes.title")}
        className="modal-tasks"
        close={onClose}
      >
        {error && <p className="modal-error">{error}</p>}
        {count === 0 ? (
          <div className="empty">
            <Icon name={agent ? "branch" : "terminal"} size={24} />
            <strong>{agent ? t("tasks.none") : t("processes.none")}</strong>
            <span>{agent ? t("tasks.noneHint") : t("processes.noneHint")}</span>
          </div>
        ) : (
          <>
            <p className="tasks-sub">{subtitle}</p>
            <ul className="card tasks-list">
              {agent &&
                tasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="task-open"
                      onClick={() => setSelected({ id: task.id, kind: "agent" })}
                    >
                      <span className="task-icon">
                        <Icon name="branch" size={16} />
                      </span>
                      <span className="task-main">
                        <span className="task-title clip">{task.task}</span>
                        <span className="task-sub clip">
                          {t("tasks.subAgent")} · {task.model} · {costLabel(task)}
                        </span>
                      </span>
                      <span className={`badge ${statusTone(task.status)}`}>
                        {labels[task.status]}
                      </span>
                      <Icon name="chevronRight" size={14} />
                    </button>
                  </li>
                ))}
              {!agent &&
                processes.map((record) => (
                  <li key={record.id}>
                    <button
                      type="button"
                      className="task-open"
                      onClick={() => setSelected({ id: record.id, kind: "shell" })}
                    >
                      <span className="task-icon">
                        <Icon name="terminal" size={16} />
                      </span>
                      <span className="task-main">
                        <span className="task-title mono clip">{record.command}</span>
                        <span className="task-sub clip">
                          {t("processes.command")}
                          {record.exit_code !== null
                            ? ` · ${t("processes.exitCode", { code: record.exit_code })}`
                            : ""}
                        </span>
                      </span>
                      <span className={`badge ${statusTone(record.status)}`}>
                        {labels[record.status]}
                      </span>
                      <Icon name="chevronRight" size={14} />
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </Dialog>
      {selected?.kind === "agent" && (
        <TaskDetail
          taskId={selected.id}
          onClose={() => setSelected(null)}
          onOpen={(id) => setSelected({ id, kind: "agent" })}
          onChanged={updateTask}
        />
      )}
      {selected?.kind === "shell" && (
        <ProcessDetail
          key={selected.id}
          processId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={updateProcess}
        />
      )}
    </>
  );
}

function TaskDetail({
  taskId,
  onClose,
  onOpen,
  onChanged,
}: {
  taskId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: (task: Task) => void;
}) {
  const t = useT();
  const currentTask = useRef(taskId);
  const oldestLoaded = useRef<number | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [messages, setMessages] = useState<RawMessage[]>([]);
  const [compactions, setCompactions] = useState<Compaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [showInherited, setShowInherited] = useState(false);
  const [error, setError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    currentTask.current = taskId;
    oldestLoaded.current = null;
    setLoadingOlder(false);
    setStopping(false);
    setShowInherited(false);
    setTask(null);
    setMessages([]);
    setCompactions([]);
    setError("");
    async function load() {
      try {
        const [record, history, summaries] = await Promise.all([
          api.get<Task>(`/api/tasks/${taskId}`),
          api.get<{ messages: RawMessage[]; has_more: boolean }>(
            `/api/tasks/${taskId}/messages?limit=100`,
          ),
          api.get<{ compactions: Compaction[] }>(`/api/tasks/${taskId}/compactions`),
        ]);
        if (!current) {
          return;
        }
        setTask(record);
        setMessages((previous) => mergeMessages(previous, history.messages));
        setCompactions(summaries.compactions);
        const first = history.messages[0];
        if (oldestLoaded.current === null || (first && first.id <= oldestLoaded.current)) {
          oldestLoaded.current = first?.id ?? null;
          setHasMore(history.has_more);
        }
        setError("");
        if (active(record)) {
          timer = setTimeout(() => void load(), 1500);
        }
      } catch (failure) {
        if (current) {
          setError(failure instanceof Error ? failure.message : t("tasks.loadFailed"));
        }
      }
    }
    void load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [taskId]);
  async function stop() {
    if (stopping) {
      return;
    }
    const requestedTask = taskId;
    setStopping(true);
    try {
      const updated = await api.post<Task>(`/api/tasks/${taskId}/cancel`);
      onChanged(updated);
      if (currentTask.current === requestedTask) {
        setTask(updated);
      }
    } catch (failure) {
      if (currentTask.current === requestedTask) {
        setError(failure instanceof Error ? failure.message : t("tasks.stopFailed"));
      }
    } finally {
      if (currentTask.current === requestedTask) {
        setStopping(false);
      }
    }
  }
  async function older() {
    if (!messages.length || loadingOlder) {
      return;
    }
    setLoadingOlder(true);
    const requestedTask = taskId;
    try {
      const page = await api.get<{ messages: RawMessage[]; has_more: boolean }>(
        `/api/tasks/${taskId}/messages?limit=100&before=${messages[0].id}`,
      );
      if (currentTask.current !== requestedTask) {
        return;
      }
      oldestLoaded.current = page.messages[0]?.id ?? oldestLoaded.current;
      setMessages((previous) => mergeMessages(page.messages, previous));
      setHasMore(page.has_more);
    } catch (failure) {
      if (currentTask.current === requestedTask) {
        setError(failure instanceof Error ? failure.message : t("tasks.loadFailed"));
      }
    } finally {
      if (currentTask.current === requestedTask) {
        setLoadingOlder(false);
      }
    }
  }
  const visible = messages.filter((row) => showInherited || !row.meta?.inherited);
  const rows = projectRows(visible, compactions, [], false);
  return (
    <Dialog title={t("tasks.detail")} className="modal-xwide" close={onClose}>
      {error && <p className="modal-error">{error}</p>}
      {!task ? (
        <p className="note">{error ? "" : t("tasks.loading")}</p>
      ) : (
        <>
          <div className="task-brief">
            <p className="task-description">{task.task}</p>
            <div className="pill-row">
              <span className={`badge ${statusTone(task.status)}`}>{labels[task.status]}</span>
              <span className="pill mono">{task.model}</span>
              <span className="pill">{t("tasks.requests", { n: task.request_count })}</span>
              <span className="pill">{costLabel(task)}</span>
              {task.parent_task_id && (
                <button
                  type="button"
                  className="text-link task-parent"
                  onClick={() => onOpen(task.parent_task_id!)}
                >
                  {t("tasks.parent")}
                </button>
              )}
            </div>
          </div>
          {task.error && <p className="modal-error">{task.error}</p>}
          {messages.some((row) => row.meta?.inherited) && (
            <label className="check-row task-inherited">
              <input
                type="checkbox"
                checked={showInherited}
                onChange={(event) => setShowInherited(event.target.checked)}
              />
              {t("tasks.showInherited")}
            </label>
          )}
          {hasMore && (
            <button
              className="btn btn-plain task-older"
              disabled={loadingOlder}
              onClick={() => void older()}
            >
              {loadingOlder ? t("common.reading") : t("tasks.older")}
            </button>
          )}
          <div className="task-transcript">
            {rows.map((row) => {
              if (row.role === "tool") {
                return <ToolItem key={row._key} row={row} />;
              }
              if (row.reasoning) {
                return <ThinkItem key={row._key} row={row} />;
              }
              if (row.role === "system") {
                return (
                  <details key={row._key} className="task-summary">
                    <summary>{t("tasks.summary")}</summary>
                    <div
                      className="md"
                      dangerouslySetInnerHTML={{
                        __html: renderMd(row.content || ""),
                      }}
                    />
                  </details>
                );
              }
              return (
                <article key={row._key} className={`task-message ${row.role}`}>
                  <small>{row.role === "user" ? t("tasks.input") : "Agent"}</small>
                  <div
                    className="md"
                    dangerouslySetInnerHTML={{
                      __html: renderMd(row.content || ""),
                    }}
                  />
                  {!!row.attachments?.length && (
                    <div className="msg-attachments">
                      {row.attachments.map((attachment) =>
                        isImage(attachment) ? (
                          <AttachmentImage key={attachment.id} image={attachment} />
                        ) : attachment.url ? (
                          <a
                            key={attachment.id}
                            href={attachment.url}
                            className="msg-file"
                            download={attachment.name}
                          >
                            <Icon name="file" size={16} />
                            {attachment.name}
                          </a>
                        ) : (
                          <span className="msg-file" key={attachment.id}>
                            <Icon name="file" size={16} />
                            {attachment.name}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {active(task) && (
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-danger"
                disabled={stopping || task.status === "cancelling"}
                onClick={() => void stop()}
              >
                {stopping || task.status === "cancelling" ? t("tasks.stopping") : t("tasks.stop")}
              </button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
