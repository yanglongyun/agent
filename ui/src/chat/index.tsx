import { useEffect } from "react";
import { ConversationMenu } from "./ConversationMenu";
import { Composer } from "./Composer";
import { useT } from "@/i18n";
import { MessageStream } from "./MessageStream";
import { Icon } from "@/icons/Icon";
import { useShell } from "@/app/layout";
import { initConversation, useConversation } from "./store";
export default function ConversationApp() {
  const t = useT();
  const shell = useShell();
  const { conversations, currentId, messages, ready, viewKey, indexReady } = useConversation();
  useEffect(() => {
    initConversation();
  }, [indexReady]);
  const title =
    conversations.find((conversation) => conversation.id === currentId)?.title ||
    t("conversation.untitled");
  return (
    <div className="app">
      <header className="topbar">
        <button
          className={`icon-btn menu-btn${shell.collapsed ? " show" : ""}`}
          title={t("side.openSidebar")}
          onClick={shell.openMenu}
        >
          <Icon name="panel" size={17} />
        </button>
        <span className="title ellipsis">{title}</span>
        <span className="spacer" />
        <ConversationMenu />
      </header>

      <div className={`conversation-main${ready && !messages.length ? " conversation-blank" : ""}`}>
        <MessageStream />
        <Composer key={viewKey} draftId={currentId || `new:${viewKey}`} />
      </div>
    </div>
  );
}
