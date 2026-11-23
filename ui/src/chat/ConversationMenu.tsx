import { useEffect, useRef, useState } from "react";
import { Icon } from "@/icons/Icon";
import { useT } from "@/i18n";
import { requestRemove, requestRename } from "./actions";
import { setPinned, useConversation } from "./store";
import { selectedModel, threadTitle, useThread } from "@/thread/store";
import { costLabel } from "@/thread/metering";
import { active } from "@/tasks/status";
import { TasksDialog } from "@/tasks/Tasks";
import { useSessionActivity } from "@/tasks/activity";
import { ModelUsage } from "@/tasks/ModelUsage";
import { Dialog } from "@/overlay/Dialog";

// 标题栏右上角的「更多」菜单：后台任务、后台命令、对话详情、星标、重命名、删除。
export function ConversationMenu() {
  const t = useT();
  const { conversations, currentId, busy, generation } = useConversation();
  const activity = useSessionActivity(currentId, busy, generation);
  const chat = conversations.find((row) => row.id === currentId);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"agent" | "shell" | "info" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const down = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  useEffect(() => setOpen(false), [currentId]);
  const runningTasks = activity.tasks.filter(active).length;
  const runningProcesses = activity.processes.filter(active).length;
  return (
    <div className="topbar-menu-wrap" ref={box}>
      <button
        className={`icon-btn has-dot${open ? " on" : ""}`}
        aria-label={t("conversation.more")}
        title={t("conversation.more")}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" size={17} />
        {runningTasks + runningProcesses > 0 && (
          <span
            className="icon-dot"
            aria-label={t("tasks.running", {
              n: runningTasks + runningProcesses,
            })}
          />
        )}
      </button>
      {open && (
        <div className="topbar-menu" role="menu">
          {chat && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setPanel("agent");
                }}
              >
                <Icon name="branch" size={15} />
                {t("tasks.title")}
                <span className="grow" />
                {activity.tasks.length > 0 && (
                  <span className={`badge${runningTasks > 0 ? " is-ok is-live" : ""}`}>
                    {runningTasks > 0
                      ? t("tasks.running", { n: runningTasks })
                      : activity.tasks.length}
                  </span>
                )}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setPanel("shell");
                }}
              >
                <Icon name="terminal" size={15} />
                {t("processes.title")}
                <span className="grow" />
                {activity.processes.length > 0 && (
                  <span className={`badge${runningProcesses > 0 ? " is-ok is-live" : ""}`}>
                    {runningProcesses > 0
                      ? t("processes.running", { n: runningProcesses })
                      : activity.processes.length}
                  </span>
                )}
              </button>
              <hr />
            </>
          )}
          {chat && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPanel("info");
              }}
            >
              <Icon name="info" size={15} />
              {t("details.title")}
            </button>
          )}
          {chat && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void setPinned(chat.id, !chat.pinned);
              }}
            >
              <Icon name={chat.pinned ? "starFill" : "star"} size={15} />
              {t(chat.pinned ? "conversation.unpin" : "conversation.pin")}
            </button>
          )}
          {chat && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                requestRename(chat);
              }}
            >
              <Icon name="pencil" size={15} />
              {t("conversation.rename")}
            </button>
          )}
          {chat && <hr />}
          {chat && (
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setOpen(false);
                void requestRemove(chat);
              }}
            >
              <Icon name="trash" size={15} />
              {t("common.delete")}
            </button>
          )}
          {!chat && (
            <button role="menuitem" onClick={() => setPanel("info")}>
              <Icon name="info" size={15} />
              {t("details.title")}
            </button>
          )}
        </div>
      )}
      {(panel === "agent" || panel === "shell") && (
        <TasksDialog kind={panel} activity={activity} onClose={() => setPanel(null)} />
      )}
      {panel === "info" && <DetailsDialog onClose={() => setPanel(null)} />}
    </div>
  );
}

function DetailsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const state = useThread();
  const { currentId, threads, status, compactions } = state;
  const current = threads.find((thread) => thread.id === currentId);
  const model = selectedModel(state);
  const cost = current || {
    cost: { amount: 0, currency: "USD", unpriced_requests: 0 },
    request_count: 0,
  };
  return (
    <Dialog title={t("details.title")} className="modal-tasks" close={onClose}>
      <dl className="kv">
        <div>
          <dt>{t("details.conversation")}</dt>
          <dd>{current ? threadTitle(current) : t("conversation.untitled")}</dd>
        </div>
        <div>
          <dt>{t("details.model")}</dt>
          <dd>{model ? model.name : t("details.noModel")}</dd>
        </div>
        <div>
          <dt>{t("details.cost")}</dt>
          <dd>{costLabel(cost)}</dd>
        </div>
        <div>
          <dt>{t("details.requests")}</dt>
          <dd>{t("tasks.requests", { n: cost.request_count })}</dd>
        </div>
        <div>
          <dt>{t("details.compactions")}</dt>
          <dd>{t("details.compactionsCount", { n: compactions.length })}</dd>
        </div>
        {status?.workdir && (
          <div>
            <dt>{t("details.workdir")}</dt>
            <dd className="mono">{status.workdir}</dd>
          </div>
        )}
      </dl>
      {currentId && <ModelUsage sessionId={currentId} />}
    </Dialog>
  );
}
