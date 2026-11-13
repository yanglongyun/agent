import { useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";

import { Icon } from "../icons/Icon";
import { TasksPanel } from "../tasks/Tasks";
import { send, stopRun, useThread, selectedModel } from "./store";
import { useDraftSeed } from "./draft";
import { toast } from "../overlay/toast";
import { costLabel } from "./metering";
import { ChatInputFrame, FilePreview } from "../components/ruixen/ChatInput";
import { Hint } from "../overlay/Hint";
import { isImageAttachment, validateAttachments, type UploadAttachment } from "./attachments";

export function Composer() {
  const navigate = useNavigate();
  const showCreatedSession = (id: string) => {
    if (window.location.pathname === "/") {
      navigate(`/sessions/${id}`, { replace: true });
    }
  };
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<UploadAttachment[]>([]);
  const [reading, setReading] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const attachmentVersion = useRef(0);
  const readingAttachments = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const state = useThread();
  const { busy, stopping, currentId, status, threads, connected } = state;
  const model = selectedModel(state);
  const current = threads.find((thread) => thread.id === currentId);
  const cost = currentId
    ? current
    : { cost: { amount: 0, currency: "USD", unpriced_requests: 0 }, request_count: 0 };
  const seed = useDraftSeed();

  // 草稿按对话落 localStorage,重启不丢;空白草稿记在 blank 键下
  const draftKey = `agentic.draft:${currentId || "blank"}`;
  useEffect(() => {
    attachmentVersion.current++;
    readingAttachments.current = false;
    setReading(false);
    setAttachments([]);
    try {
      setText(localStorage.getItem(draftKey) || "");
    } catch {
      setText("");
    }
    const element = areaRef.current;
    if (element) {
      requestAnimationFrame(() => autosize(element));
    }
  }, [draftKey]);
  useEffect(
    () => () => {
      attachmentVersion.current++;
    },
    [],
  );
  const persistDraft = (value: string) => {
    try {
      if (value) {
        localStorage.setItem(draftKey, value);
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      /* 私隐模式存不了就算了 */
    }
  };

  const canSend =
    connected &&
    Boolean(model) &&
    !busy &&
    !reading &&
    (text.trim().length > 0 || attachments.length > 0);

  const addAttachments = async (files: File[]) => {
    if (busy || readingAttachments.current || files.length === 0) {
      return;
    }
    const error = validateAttachments([...attachments, ...files]);
    if (error) {
      toast(error);
      return;
    }
    const version = attachmentVersion.current;
    readingAttachments.current = true;
    setReading(true);
    try {
      const selected: UploadAttachment[] = [];
      for (const file of files) {
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
          reader.readAsDataURL(file);
        });
        selected.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          data: url,
        });
      }
      if (attachmentVersion.current === version) {
        setAttachments((current) => [...current, ...selected]);
      }
    } catch (error) {
      if (attachmentVersion.current === version) {
        toast(error instanceof Error ? error.message : "图片读取失败");
      }
    } finally {
      if (attachmentVersion.current === version) {
        readingAttachments.current = false;
        setReading(false);
      }
    }
  };

  const autosize = (element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  };

  // 起手卡点了 → 填进输入框(不发),光标落尾部
  useEffect(() => {
    if (!seed.version) {
      return;
    }
    setText(seed.text);
    persistDraft(seed.text);
    const element = areaRef.current;
    if (element) {
      element.focus();
      requestAnimationFrame(() => autosize(element));
    }
  }, [seed.version]);

  const submit = () => {
    if (!canSend) {
      return;
    }
    if (
      !send(
        text,
        null,
        showCreatedSession,
        attachments.filter(isImageAttachment).map((file) => file.data),
        attachments.filter((file) => !isImageAttachment(file)),
      )
    ) {
      return;
    }
    setText("");
    setAttachments([]);
    persistDraft("");
    if (areaRef.current) {
      areaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="composer-wrap">
      {currentId && <TasksPanel key={currentId} sessionId={currentId} busy={busy} />}
      <ChatInputFrame
        onFocus={() => areaRef.current?.focus()}
        onFiles={(files) => void addAttachments(files)}
        disabled={busy || reading}
      >
        {attachments.length > 0 && (
          <div className="composer-files">
            {attachments.map((file, index) => (
              <FilePreview
                key={index}
                file={file}
                onRemove={() =>
                  setAttachments((current) => current.filter((_, position) => position !== index))
                }
              />
            ))}
          </div>
        )}
        <div className="composer-row">
          <input
            ref={attachmentInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void addAttachments(Array.from(event.target.files || []));
              event.target.value = "";
            }}
          />
          <Hint text="添加附件 · 最多 5 个">
            <button
              type="button"
              className="attachment-picker"
              aria-label="添加附件"
              disabled={busy || reading || attachments.length === 5}
              onClick={(event) => {
                event.stopPropagation();
                attachmentInput.current?.click();
              }}
            >
              <Icon name="attachment" size={20} />
            </button>
          </Hint>
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            placeholder={connected ? "发消息…" : "正在重新连接…"}
            aria-label="消息"
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                void addAttachments(files);
              }
            }}
            onChange={(event) => {
              setText(event.target.value);
              persistDraft(event.target.value);
              autosize(event.target);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }
              event.preventDefault();
              submit();
            }}
          />
          {busy ? (
            <button
              className="round stop"
              title={stopping ? "正在停止…" : "停止"}
              aria-label="停止"
              disabled={stopping}
              onClick={(event) => {
                event.stopPropagation();
                stopRun();
              }}
            >
              <Icon name="stop" size={15} />
            </button>
          ) : (
            <button
              className="round go"
              title="发送"
              aria-label="发送"
              disabled={!canSend}
              onClick={(event) => {
                event.stopPropagation();
                submit();
              }}
            >
              <Icon name="send" size={17} />
            </button>
          )}
        </div>
      </ChatInputFrame>
      <div className="composer-footer">
        {attachments.length > 0 && <span className="foot-tag">{attachments.length}/5 个附件</span>}
        {reading && <span className="foot-tag">读取附件…</span>}
        <span className="foot-note clip" title={status?.workdir}>
          {status?.workdir && (
            <>
              <Icon name="folder" size={12} />
              <span className="clip">
                {status.workdir.split(/[\\/]/).filter(Boolean).at(-1) || status.workdir}
              </span>
            </>
          )}
        </span>
        <span
          className="composer-cost"
          aria-live="polite"
          title="包含本对话、所有子任务和上下文压缩的已记录费用"
        >
          累计 {cost ? costLabel(cost) : "加载中…"}
        </span>
      </div>
    </div>
  );
}
