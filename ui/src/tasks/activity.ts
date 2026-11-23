import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { active } from "./status";
import { updateSessionCost, useThread } from "@/thread/store";
import type { OwnerCost } from "@/thread/metering";

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

// 当前对话的子任务与后台命令：有活跃项时每 1.5 秒轮询，否则只读一次。
export function useSessionActivity(
  sessionId: string,
  busy: boolean,
  generation: number,
): SessionActivity {
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
        if (!current || useThread.getState().generation !== generation) {
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
  }, [sessionId, busy, generation]);

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
