import { useNavigate } from "@/lib/router";
import { useShell } from "@/app/layout";
import { Resizer } from "@/app/Resizer";
import { Icon } from "@/icons/Icon";
import { useT } from "@/i18n";
import { useConversation, createConversation, switchConversation } from "@/chat/store";
import { requestRemove, requestRename } from "@/chat/actions";
import { useConversationGroups } from "./ConversationList";

export function Sidebar() {
  const t = useT();
  const shell = useShell();
  const navigate = useNavigate();
  const conversations = useConversation((state) => state.conversations);
  const go = (path: string) => {
    navigate(path);
    shell.closeSidebar();
  };
  const groups = useConversationGroups({
    onRename: requestRename,
    onRemove: (conversation) => void requestRemove(conversation),
    onPick: (id) => {
      go("/conversation");
      void switchConversation(id);
    },
  });
  return (
    <>
      {shell.sidebarOpen && (
        <button className="side-mask" aria-label={t("common.close")} onClick={shell.closeSidebar} />
      )}
      <aside
        inert={shell.mobile && !shell.sidebarOpen}
        className={`sidebar${shell.sidebarOpen ? " open" : ""}${shell.collapsed ? " collapsed" : ""}`}
        style={
          shell.sidebarWidth
            ? ({ "--side-w": `${shell.sidebarWidth}px` } as React.CSSProperties)
            : undefined
        }
        aria-label={t("side.conversations")}
      >
        <div className="side-titlebar">
          <span className="side-brand">Agent</span>
          <span className="grow" />
          <button
            className="icon-btn fold-btn"
            title={t("side.collapseSidebar")}
            aria-label={t("side.collapseSidebar")}
            onClick={shell.toggleCollapsed}
          >
            <Icon name="panel" size={17} />
          </button>
        </div>
        <div className="side-scroll">
          <nav className="side-nav">
            <button
              className="side-item"
              onClick={() => {
                createConversation();
                go("/conversation");
              }}
            >
              <Icon name="pencil" size={17} />
              <span>{t("side.newConversation")}</span>
            </button>
          </nav>
          {groups.pinnedEl}
          {groups.recentEl}
          {!conversations.length && <div className="conv-empty">{t("side.noConversations")}</div>}
        </div>
        <div className="side-bottom">
          <button className="side-item" title={t("settings.title")} onClick={() => go("/settings")}>
            <Icon name="settings" size={17} />
            <span>{t("settings.title")}</span>
          </button>
        </div>
        <Resizer target="sidebar" />
      </aside>
    </>
  );
}
