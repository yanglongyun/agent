import { useEffect, useRef, useState } from "react";
import { labels, active } from "./status";
import { ProcessDetail, type ShellJob } from "./Processes";
import { Sheet } from "../overlay/Sheet";
import { api } from "../lib/api";
import { Icon } from "../icons/Icon";
import { renderMd } from "../thread/format";
import { buildRows, mergeMessages, type RawMessage, type Compaction } from "../thread/thread";
import { ToolItem, ThinkItem } from "../thread/Process";
import { Usage } from "../thread/Usage";
import { AttachmentInfo } from "../thread/AttachmentInfo";
import { costLabel, type OwnerCost } from "../thread/metering";
import { updateSessionCost } from "../thread/store";
import "./tasks.css";

export interface Task extends OwnerCost {
  id: string;
  session_id: string;
  parent_task_id: string | null;
  task: string;
  model: string;
  status: string;
  result: string | null;
  error: string | null;
}

export interface SessionActivity {
  tasks: Task[];
  processes: ShellJob[];
  error: string;
  runningCount: number;
  totalCount: number;
  totalCost: OwnerCost;
  updateTask: (task: Task) => void;
  updateProcess: (record: ShellJob) => void;
}

export function useSessionActivity(sessionId: string, busy: boolean): SessionActivity {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [processes, setProcesses] = useState<ShellJob[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setTasks([]);
    setProcesses([]);
    setError("");
    if (!sessionId) {
      return;
    }
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const [result, commands] = await Promise.all([
          api.get<{ tasks: Task[]; session: OwnerCost & { id: string } }>(
            `/api/tasks?session_id=${encodeURIComponent(sessionId)}`,
          ),
          api.get<{ processes: ShellJob[] }>(
            `/api/processes?session_id=${encodeURIComponent(sessionId)}`,
          ),
        ]);
        if (!current) {
          return;
        }
        setTasks(result.tasks);
        updateSessionCost(result.session);
        setProcesses(commands.processes);
        setError("");
        if (busy || result.tasks.some(active) || commands.processes.some(active)) {
          timer = setTimeout(() => void load(), 1500);
        }
      } catch (failure) {
        if (current) {
          setError(failure instanceof Error ? failure.message : "任务读取失败");
          timer = setTimeout(() => void load(), 3000);
        }
      }
    }
    void load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [sessionId, busy]);

  const runningCount = tasks.filter(active).length + processes.filter(active).length;
  const totalCount = tasks.length + processes.length;
  const totalCost: OwnerCost = {
    cost: { amount: 0, currency: "USD", unpriced_requests: 0 },
    request_count: 0,
  };
  let nano = 0;
  for (const task of tasks) {
    nano += Math.round(task.cost.amount * 1e9);
    totalCost.cost.unpriced_requests += task.cost.unpriced_requests;
    totalCost.request_count += task.request_count;
  }
  totalCost.cost.amount = nano / 1e9;
  return {
    tasks,
    processes,
    error,
    runningCount,
    totalCount,
    totalCost,
    updateTask: (task) =>
      setTasks((current) => current.map((row) => (row.id === task.id ? task : row))),
    updateProcess: (record) =>
      setProcesses((current) => current.map((row) => (row.id === record.id ? record : row))),
  };
}

export function TasksSheet({
  activity,
  onClose,
}: {
  activity: SessionActivity;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<{ id: string; kind: "agent" | "shell" } | null>(null);
  const { tasks, processes, error, runningCount, totalCost, updateTask, updateProcess } = activity;
  let subtitle = "暂无活动任务或后台命令";
  if (tasks.length || processes.length) {
    const statusText = runningCount > 0 ? `${runningCount} 项执行中` : "全部已结束";
    subtitle = tasks.length > 0 ? `${statusText} · ${costLabel(totalCost)}` : statusText;
  }

  return (
    <>
      <Sheet
        title="任务与后台命令"
        className="tasks-sheet"
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            关闭
          </button>
        }
      >
        <p className="tasks-sheet-sub">{subtitle}</p>
        {error && <p className="sheet-error">{error}</p>}
        {!tasks.length && !processes.length ? (
          <div className="tasks-empty">
            <Icon name="terminal" size={24} />
            <span>当前对话还没有委派子任务或后台命令</span>
          </div>
        ) : (
          <ul className="tasks-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="task-open"
                  onClick={() => setSelected({ id: task.id, kind: "agent" })}
                >
                  <span className="task-title">{task.task}</span>
                  <span className={`task-status ${task.status}`}>{labels[task.status]}</span>
                </button>
                <small>
                  子 Agent · {task.model} · {costLabel(task)}
                </small>
              </li>
            ))}
            {processes.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className="task-open"
                  onClick={() => setSelected({ id: record.id, kind: "shell" })}
                >
                  <span className="task-title">{record.command}</span>
                  <span className={`task-status ${record.status}`}>{labels[record.status]}</span>
                </button>
                <small>
                  后台命令{record.exit_code !== null ? ` · 退出码 ${record.exit_code}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
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
          setError(failure instanceof Error ? failure.message : "任务读取失败");
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
        setError(failure instanceof Error ? failure.message : "停止失败");
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
        setError(failure instanceof Error ? failure.message : "消息读取失败");
      }
    } finally {
      if (currentTask.current === requestedTask) {
        setLoadingOlder(false);
      }
    }
  }
  const visible = messages.filter((row) => showInherited || !row.meta?.inherited);
  const rows = buildRows(visible, compactions);
  return (
    <Sheet
      title="子任务详情"
      className="task-detail"
      onClose={onClose}
      footer={
        <>
          {task && <span className={`task-state ${task.status}`}>{labels[task.status]}</span>}
          {task && active(task) && (
            <button
              type="button"
              className="btn btn-quiet task-stop"
              disabled={stopping || task.status === "cancelling"}
              onClick={() => void stop()}
            >
              {stopping || task.status === "cancelling" ? "正在停止…" : "停止任务"}
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      {error && <p className="sheet-error">{error}</p>}
      {!task ? (
        <p className="tasks-note">{error ? "" : "正在读取任务…"}</p>
      ) : (
        <>
          <p className="task-description">{task.task}</p>
          <div className="task-facts">
            <span>{task.model}</span>
            <span>{task.request_count} 次请求</span>
            <span>{costLabel(task)}</span>
          </div>
          {task.parent_task_id && (
            <button
              type="button"
              className="task-parent"
              onClick={() => onOpen(task.parent_task_id!)}
            >
              查看父任务
            </button>
          )}
          {task.error && <p className="sheet-error">{task.error}</p>}
          {messages.some((row) => row.meta?.inherited) && (
            <label className="task-inherited">
              <input
                type="checkbox"
                checked={showInherited}
                onChange={(event) => setShowInherited(event.target.checked)}
              />
              显示继承的上下文
            </label>
          )}
          {hasMore && (
            <button className="btn btn-quiet" disabled={loadingOlder} onClick={() => void older()}>
              查看更早的消息
            </button>
          )}
          <div className="task-transcript">
            {rows.map((row) => {
              if (row.kind === "tool") {
                return <ToolItem key={row.key} row={row} />;
              }
              if (row.kind === "usage" && row.usageRecord) {
                return <Usage key={row.key} records={[row.usageRecord]} />;
              }
              if (row.code === "compacted") {
                return (
                  <details key={row.key} className="task-summary">
                    <summary>历史摘要</summary>
                    <div
                      className="md"
                      dangerouslySetInnerHTML={{ __html: renderMd(row.content || "") }}
                    />
                    {row.usageRecord && <Usage records={[row.usageRecord]} />}
                  </details>
                );
              }
              if (row.reasoning) {
                return <ThinkItem key={row.key} row={row} />;
              }
              return (
                <article key={row.key} className={`task-message ${row.kind}`}>
                  <small>{row.kind === "user" ? "任务输入" : "Agent"}</small>
                  <div
                    className="md"
                    dangerouslySetInnerHTML={{ __html: renderMd(row.content || "") }}
                  />
                  {row.images?.map((url) => (
                    <img key={url} src={url} alt="任务图片" />
                  ))}
                  {row.attachments && row.attachments.length > 0 && (
                    <div className="message-attachments">
                      {row.attachments.map((file, index) => (
                        <a
                          key={index}
                          href={file.url}
                          className="attachment-card"
                          download={file.name}
                        >
                          <AttachmentInfo file={file} />
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}
