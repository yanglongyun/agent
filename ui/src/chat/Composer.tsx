import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/icons/Icon";
import { composingGuard } from "@/lib/composing";
import { abort, consumeRestoredDraft, send, useConversation } from "@/chat/store";
import { useToast } from "@/overlay/toast";
import { getDraft, saveDraft } from "./drafts";
import { ModelPicker } from "./ModelPicker";
import {
  MAX_ATTACHMENTS,
  chooseAttachments,
  isImage,
  listenForAttachmentDrops,
  saveClipboardFiles,
} from "./attachments";
import { AttachmentImage } from "./AttachmentImage";
import type { Attachment } from "./thread";
import { useT } from "@/i18n";

export function Composer({ draftId }: { draftId: string }) {
  const t = useT();
  const [text, setText] = useState(() => getDraft(draftId).text);
  const [attachments, setAttachments] = useState<Attachment[]>(() => getDraft(draftId).attachments);
  useEffect(() => {
    saveDraft(draftId, { text, attachments });
  }, [draftId, text, attachments]);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const { busy, aborting, ready, connected, restoredDraft } = useConversation();
  const guard = useMemo(composingGuard, []);
  const canSend = connected && !busy && (text.trim().length > 0 || attachments.length > 0);
  // 撤回的消息回到输入框，继续编辑后重发。
  useEffect(() => {
    if (!restoredDraft) {
      return;
    }
    setText(restoredDraft.text);
    setAttachments(restoredDraft.attachments);
    consumeRestoredDraft();
  }, [restoredDraft]);
  const addAttachments = (next: Attachment[]) => {
    setAttachments((current) => {
      const paths = new Set(current.map((item) => item.id));
      return [...current, ...next.filter((item) => item.id && !paths.has(item.id))].slice(
        0,
        MAX_ATTACHMENTS,
      );
    });
  };
  const complain = (what: string) => (error: unknown) => {
    console.error(what, error);
    useToast.getState().show(error instanceof Error ? error.message : what, 2600);
  };
  useEffect(
    () =>
      listenForAttachmentDrops((files) => {
        void saveClipboardFiles(files)
          .then(addAttachments)
          .catch(complain(t("conversation.filePickerFailed")));
      }),
    [],
  );
  const submit = () => {
    if (!canSend) {
      return;
    }
    const content = text;
    const selected = attachments;
    setText("");
    setAttachments([]);
    if (areaRef.current) {
      areaRef.current.style.height = "auto";
    }
    void send(content, selected);
  };
  const sizeLabel = (n: number) =>
    n < 1024
      ? `${n}B`
      : n < 1048576
        ? `${Math.round(n / 1024)}KB`
        : `${(n / 1048576).toFixed(1)}MB`;
  return (
    <div className="composer-wrap">
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachment-tray">
            {attachments.map((attachment) => (
              <div className="attachment-chip" key={attachment.id}>
                {isImage(attachment) ? (
                  <AttachmentImage image={attachment} eager />
                ) : (
                  <span className="attachment-file">
                    <Icon name="file" size={18} />
                  </span>
                )}
                <span className="attachment-meta" title={attachment.name}>
                  <b>{attachment.name}</b>
                  <span>
                    {t(isImage(attachment) ? "conversation.image" : "conversation.file")}
                    {attachment.size > 0 ? ` · ${sizeLabel(attachment.size)}` : ""}
                  </span>
                </span>
                <button
                  className="attachment-x"
                  aria-label={t("conversation.removeAttachment", {
                    name: attachment.name,
                  })}
                  onClick={() =>
                    setAttachments((items) => items.filter((item) => item.id !== attachment.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={areaRef}
          rows={2}
          value={text}
          placeholder={
            ready ? t("conversation.composerPlaceholder") : t("conversation.waitingKernel")
          }
          disabled={!ready}
          onChange={(event) => {
            setText(event.target.value);
            const element = event.target;
            element.style.height = "auto";
            element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
          }}
          onKeyDown={(event) => {
            if (!guard.isSubmit(event)) {
              return;
            }
            event.preventDefault();
            submit();
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files || []);
            if (!files.length) {
              return;
            }
            event.preventDefault();
            void saveClipboardFiles(files)
              .then(addAttachments)
              .catch(complain(t("conversation.pasteFailed")));
          }}
          onCompositionStart={guard.onCompositionStart}
          onCompositionEnd={guard.onCompositionEnd}
        />
        <div className="composer-toolbar">
          <div className="composer-left">
            <button
              className="round attach"
              title={t("conversation.addAttachment")}
              aria-label={t("conversation.addAttachment")}
              disabled={!ready || busy}
              onClick={() => {
                void chooseAttachments()
                  .then(addAttachments)
                  .catch(complain(t("conversation.filePickerFailed")));
              }}
            >
              <Icon name="plus" size={19} />
            </button>
          </div>
          <div className="composer-actions">
            <ModelPicker />
            {busy ? (
              <button
                className="round stop"
                title={aborting ? t("conversation.stopping") : t("conversation.stop")}
                disabled={aborting}
                onClick={abort}
              >
                <Icon name="stopSq" size={18} />
              </button>
            ) : (
              <button
                className="round send"
                title={t("conversation.send")}
                disabled={!canSend}
                onClick={submit}
              >
                <Icon name="send" size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="foot-note">{t("conversation.disclaimer")}</p>
    </div>
  );
}
