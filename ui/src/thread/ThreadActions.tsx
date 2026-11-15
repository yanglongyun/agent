import { useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { Sheet } from "../overlay/Sheet";
import { active } from "../tasks/status";
import { TasksSheet, useSessionActivity } from "../tasks/Tasks";
import { costLabel } from "./metering";
import { selectedModel, threadTitle, useThread } from "./store";
import { DeleteThreadSheet, RenameThreadSheet } from "./ThreadDialogs";

// 标题栏右上角的对话操作：后台任务、后台命令、对话详情、重命名、删除，各自一个图标按钮。
export function ThreadActions() {
  const navigate = useNavigate();
  const state = useThread();
  const { currentId, threads, busy, status, compactions } = state;
  const current = threads.find((thread) => thread.id === currentId);
  const model = selectedModel(state);
  const activity = useSessionActivity(currentId, busy);

  const [panel, setPanel] = useState<"agent" | "shell" | "info" | "rename" | "delete" | null>(null);

  const cost = current || {
    cost: { amount: 0, currency: "USD", unpriced_requests: 0 },
    request_count: 0,
  };

  const runningTasks = activity.tasks.filter(active).length;
  const runningCommands = activity.processes.filter(active).length;

  return (
    <>
      {currentId && (
        <Hint text="后台任务">
          <button
            type="button"
            className="icon-btn has-dot"
            aria-label="后台任务"
            onClick={() => setPanel("agent")}
          >
            <Icon name="bot" size={18} />
            {runningTasks > 0 && (
              <span className="icon-dot" aria-label={`${runningTasks} 个任务进行中`} />
            )}
          </button>
        </Hint>
      )}
      {currentId && (
        <Hint text="后台命令">
          <button
            type="button"
            className="icon-btn has-dot"
            aria-label="后台命令"
            onClick={() => setPanel("shell")}
          >
            <Icon name="terminal" size={18} />
            {runningCommands > 0 && (
              <span className="icon-dot" aria-label={`${runningCommands} 条命令进行中`} />
            )}
          </button>
        </Hint>
      )}
      <Hint text="对话详情">
        <button
          type="button"
          className="icon-btn"
          aria-label="对话详情"
          onClick={() => setPanel("info")}
        >
          <Icon name="info" size={18} />
        </button>
      </Hint>
      {currentId && (
        <Hint text="重命名">
          <button
            type="button"
            className="icon-btn"
            aria-label="重命名"
            onClick={() => setPanel("rename")}
          >
            <Icon name="pen" size={18} />
          </button>
        </Hint>
      )}
      {currentId && (
        <Hint text="删除对话">
          <button
            type="button"
            className="icon-btn danger"
            aria-label="删除对话"
            onClick={() => setPanel("delete")}
          >
            <Icon name="trash" size={18} />
          </button>
        </Hint>
      )}

      {(panel === "agent" || panel === "shell") && (
        <TasksSheet kind={panel} activity={activity} onClose={() => setPanel(null)} />
      )}

      {panel === "info" && (
        <Sheet title="对话详情" onClose={() => setPanel(null)}>
          <dl className="kv">
            <div>
              <dt>对话</dt>
              <dd>{current ? threadTitle(current) : "新对话"}</dd>
            </div>
            <div>
              <dt>当前模型</dt>
              <dd>{model ? model.name : "未配置"}</dd>
            </div>
            <div>
              <dt>累计费用</dt>
              <dd>{costLabel(cost)}</dd>
            </div>
            <div>
              <dt>请求次数</dt>
              <dd>{cost.request_count} 次</dd>
            </div>
            <div>
              <dt>上下文压缩</dt>
              <dd>{compactions.length} 次</dd>
            </div>
            {status?.workdir && (
              <div>
                <dt>工作目录</dt>
                <dd className="mono">{status.workdir}</dd>
              </div>
            )}
            {status?.version && (
              <div>
                <dt>版本</dt>
                <dd>v{status.version}</dd>
              </div>
            )}
          </dl>
        </Sheet>
      )}

      {panel === "rename" && current && (
        <RenameThreadSheet thread={current} onClose={() => setPanel(null)} />
      )}

      {panel === "delete" && current && (
        <DeleteThreadSheet
          thread={current}
          onClose={() => setPanel(null)}
          onDeleted={() => navigate("/")}
        />
      )}
    </>
  );
}
