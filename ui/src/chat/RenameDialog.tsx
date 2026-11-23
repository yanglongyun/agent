import { useState } from "react";
import { Dialog } from "@/overlay/Dialog";
import { useT } from "@/i18n";
import { useToast } from "@/overlay/toast";
import { useChatActions } from "./actions";
import { renameConversation, type Conversation } from "./store";
function RenameForm({ conversation }: { conversation: Conversation }) {
  const t = useT();
  const [text, setText] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const close = () => useChatActions.setState({ renaming: null });
  return (
    <Dialog title={t("conversation.renameTitle")} close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim() || busy) {
            return;
          }
          setBusy(true);
          void renameConversation(conversation.id, text.trim())
            .then(close)
            .catch((error) => useToast.getState().show(String(error)))
            .finally(() => setBusy(false));
        }}
      >
        <input
          className="input"
          aria-label={t("conversation.titlePlaceholder")}
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={200}
        />
        <div className="modal-foot">
          <button type="button" className="btn btn-plain" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function RenameDialog() {
  const conversation = useChatActions((state) => state.renaming);
  return conversation ? <RenameForm conversation={conversation} key={conversation.id} /> : null;
}
