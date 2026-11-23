import { create } from "zustand";
import { confirmDialog } from "@/overlay/confirm";
import { t } from "@/i18n";
import { removeConversation, type Conversation } from "./store";
export const useChatActions = create<{
  renaming: Conversation | null;
}>(() => ({ renaming: null }));
export const requestRename = (conversation: Conversation) =>
  useChatActions.setState({ renaming: conversation });
export async function requestRemove(conversation: Conversation) {
  if (
    await confirmDialog({
      title: t("conversation.deleteTitle"),
      message: t("conversation.deleteConfirm", {
        title: conversation.title || t("conversation.untitled"),
      }),
      confirmText: t("common.delete"),
      danger: true,
    })
  ) {
    await removeConversation(conversation.id);
  }
}
