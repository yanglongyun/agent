import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import { active } from "../tasks/status";
import { TasksSheet, useSessionActivity } from "../tasks/Tasks";
import { costLabel } from "./metering";
import { ModelUsage } from "./ModelUsage";
import { selectedModel, threadTitle, useThread } from "./store";
import { DeleteThreadSheet, RenameThreadSheet } from "./ThreadDialogs";

// 标题栏右上角的「更多」菜单：后台任务、后台命令、对话详情、重命名、删除。
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
  const taskBadge = runningTasks > 0 ? `${runningTasks} 进行中` : String(activity.tasks.length);
  const commandBadge =
    runningCommands > 0 ? `${runningCommands} 进行中` : String(activity.processes.length);

  return (
    <>
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button type="button" className="icon-btn has-dot" aria-label="更多">
            <Icon name="more" size={18} />
            {runningTasks + runningCommands > 0 && (
              <span
                className="icon-dot"
                aria-label={`${runningTasks + runningCommands} 项后台任务进行中`}
              />
            )}
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            className="dropdown-content thread-more-menu"
            align="end"
            sideOffset={8}
            collisionPadding={12}
          >
            {currentId && (
              <Dropdown.Item className="dropdown-item" onSelect={() => setPanel("agent")}>
                <Icon name="bot" size={16} />
                <span className="menu-item-label">后台任务</span>
                {activity.tasks.length > 0 && (
                  <span className={`badge${runningTasks > 0 ? " is-ok is-live" : ""}`}>
                    {taskBadge}
                  </span>
                )}
              </Dropdown.Item>
            )}
            {currentId && (
              <Dropdown.Item className="dropdown-item" onSelect={() => setPanel("shell")}>
                <Icon name="terminal" size={16} />
                <span className="menu-item-label">后台命令</span>
                {activity.processes.length > 0 && (
                  <span className={`badge${runningCommands > 0 ? " is-ok is-live" : ""}`}>
                    {commandBadge}
                  </span>
                )}
              </Dropdown.Item>
            )}
            <Dropdown.Item className="dropdown-item" onSelect={() => setPanel("info")}>
              <Icon name="info" size={16} />
              <span className="menu-item-label">对话详情</span>
            </Dropdown.Item>
            {currentId && (
              <>
                <Dropdown.Separator className="dropdown-separator" />
                <Dropdown.Item className="dropdown-item" onSelect={() => setPanel("rename")}>
                  <Icon name="pen" size={16} />
                  <span className="menu-item-label">重命名</span>
                </Dropdown.Item>
                <Dropdown.Item className="dropdown-item danger" onSelect={() => setPanel("delete")}>
                  <Icon name="trash" size={16} />
                  <span className="menu-item-label">删除对话</span>
                </Dropdown.Item>
              </>
            )}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>

      {(panel === "agent" || panel === "shell") && (
        <TasksSheet kind={panel} activity={activity} onClose={() => setPanel(null)} />
      )}

      {panel === "info" && (
        <Sheet title="对话详情" className="wide" onClose={() => setPanel(null)}>
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
          {currentId && <ModelUsage sessionId={currentId} />}
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
