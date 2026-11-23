import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TurnCollapse, TurnEntries, WorkingStatus } from "./Process";
import { buildTurns } from "./turns";
import { renderMd } from "./format";
import { branchConversation, recall, retry, useConversation } from "./store";
import { isImage } from "./attachments";
import { AttachmentImage } from "./AttachmentImage";
import type { ImageAttachment, UsageRecord } from "./thread";
import { Icon } from "@/icons/Icon";
import { Mark } from "@/icons/Mark";
import { useT } from "@/i18n";
import { Dialog } from "@/overlay/Dialog";
import { copyText } from "@/lib/clipboard";

export function MessageStream() {
  const t = useT();
  const { messages, busy, ready, viewKey } = useConversation();
  const lastUserKey = messages.findLast((row) => row.role === "user")?._key;
  const blocks = useMemo(() => buildTurns(messages, busy), [messages, busy]);
  const scroll = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const [zoom, setZoom] = useState<ImageAttachment | null>(null);
  const [branching, setBranching] = useState<number | null>(null);
  const [usage, setUsage] = useState<UsageRecord[] | null>(null);
  useEffect(() => {
    setZoom(null);
    setUsage(null);
  }, [viewKey]);
  const bottom = () => {
    const node = scroll.current;
    if (node && stick.current) {
      node.scrollTop = node.scrollHeight;
      lastTop.current = node.scrollTop;
    }
  };
  useLayoutEffect(() => {
    stick.current = true;
    lastTop.current = 0;
    bottom();
  }, [viewKey, lastUserKey]);
  useLayoutEffect(bottom, [blocks, busy]);
  useEffect(() => {
    const observer = new ResizeObserver(bottom);
    if (inner.current) {
      observer.observe(inner.current);
    }
    if (scroll.current) {
      observer.observe(scroll.current);
    }
    return () => observer.disconnect();
  }, [viewKey, ready]);
  const lastFinal = blocks.findLast((block) => block.kind === "message" && block.final)?.key;
  return (
    <section
      className="page conversation-scroll"
      ref={scroll}
      aria-label={t("conversation.messages")}
      onScroll={() => {
        const node = scroll.current!;
        if (node.scrollTop < lastTop.current) {
          stick.current = false;
        }
        if (node.scrollHeight - node.scrollTop - node.clientHeight < 80) {
          stick.current = true;
        }
        lastTop.current = node.scrollTop;
      }}
    >
      <div className="conversation-inner" ref={inner} key={viewKey}>
        {ready && !messages.length && (
          <div className="conversation-hero">
            <Mark size={56} />
            <h1>{t("conversation.emptyTitle")}</h1>
          </div>
        )}
        {!ready && (
          <div className="sys-chip" role="status">
            {t("common.loading")}
          </div>
        )}
        {blocks.map((block) => {
          if (block.kind === "turn") {
            return (
              <div className="cmsg relay" key={block.key}>
                <TurnCollapse durationMs={block.durationMs}>
                  <TurnEntries items={block.items} inTurn />
                </TurnCollapse>
              </div>
            );
          }
          if (block.kind === "flat") {
            return <TurnEntries key={block.key} items={block.items} />;
          }
          const row = block.message;
          if (row.role === "system" || row.role === "developer") {
            // 停止：居中小胶囊；错误：醒目横幅；摘要与孤儿输出：可展开的柔和卡片。
            if (row.notice === "stopped") {
              return (
                <div className="sys-chip" key={block.key}>
                  {row.content}
                </div>
              );
            }
            if (row.notice === "error") {
              return (
                <div className="sys-banner" key={block.key} role="alert">
                  <Icon name="info" size={14} />
                  <span>{row.content}</span>
                </div>
              );
            }
            return (
              <details className="sys-fold" key={block.key}>
                <summary>
                  <Icon name={row.notice === "compact" ? "think" : "terminal"} size={13} />
                  <span>
                    {row.notice === "compact" ? t("conversation.compacted") : t("processes.output")}
                  </span>
                  <Icon name="chevronDown" size={12} />
                </summary>
                {row.notice === "compact" ? (
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(row.content) }} />
                ) : (
                  <pre>{row.content}</pre>
                )}
              </details>
            );
          }
          const user = row.role === "user";
          return (
            <article className={`cmsg ${user ? "client" : "relay"}`} key={block.key}>
              {!!row.attachments?.length && (
                <div className="msg-attachments">
                  {row.attachments.map((attachment) =>
                    isImage(attachment) ? (
                      <button
                        className="msg-image"
                        key={attachment.id}
                        aria-label={t("conversation.zoomImage")}
                        onClick={() => setZoom(attachment)}
                      >
                        <AttachmentImage image={attachment} onLoad={bottom} />
                      </button>
                    ) : attachment.url ? (
                      <a
                        className="msg-file"
                        key={attachment.id}
                        href={attachment.url}
                        download={attachment.name}
                      >
                        <Icon name="file" size={16} />
                        {attachment.name}
                      </a>
                    ) : (
                      <span className="msg-file" key={attachment.id}>
                        <Icon name="file" size={16} />
                        {attachment.name}
                      </span>
                    ),
                  )}
                </div>
              )}
              {row.content &&
                (user ? (
                  <div className="cbubble">{row.content}</div>
                ) : (
                  <div
                    className="md"
                    dangerouslySetInnerHTML={{
                      __html: renderMd(row.content),
                    }}
                  />
                ))}
              {row.failed && (
                <button className="retry-btn" onClick={() => retry(row)}>
                  {t("conversation.retry")}
                </button>
              )}
              {row.content && (
                <div className={`actrow${block.key === lastFinal ? " always" : ""}`}>
                  <button
                    className="act"
                    title={t("common.copy")}
                    aria-label={t("common.copy")}
                    onClick={() => {
                      void copyText(row.content!);
                    }}
                  >
                    <Icon name="copy" size={15} />
                  </button>
                  {user && row.seq !== undefined && !row.failed && (
                    <button
                      className="act"
                      title={t("conversation.recall")}
                      aria-label={t("conversation.recall")}
                      disabled={busy}
                      onClick={() => void recall(row)}
                    >
                      <Icon name="refresh" size={15} />
                    </button>
                  )}
                  {!user && row.seq !== undefined && !row.streaming && (
                    <button
                      className="act"
                      title={t("conversation.branch")}
                      aria-label={t("conversation.branch")}
                      disabled={branching !== null}
                      onClick={() => {
                        setBranching(row.seq!);
                        void branchConversation(row.seq!)
                          .finally(() => setBranching(null))
                          .catch(() => {});
                      }}
                    >
                      <Icon name="branch" size={15} />
                    </button>
                  )}
                  {!user && (
                    <button
                      className="act"
                      title={t("conversation.usage")}
                      aria-label={t("conversation.usage")}
                      onClick={() => setUsage(row.usage || [])}
                    >
                      <Icon name="info" size={15} />
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {busy && (
          <div className="cmsg relay">
            <WorkingStatus />
          </div>
        )}
      </div>
      {usage && (
        <Dialog title={t("conversation.usage")} close={() => setUsage(null)}>
          {usage.length ? (
            <>
              <dl className="usage-totals">
                {usage.map((entry, index) => (
                  <div key={index}>
                    <dt>{entry.model || t("conversation.modelCost")}</dt>
                    <dd>
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 8,
                      }).format(entry.costUsd)}
                    </dd>
                  </div>
                ))}
              </dl>
              <pre className="usage-json">
                {JSON.stringify(
                  usage.map((entry) => entry.raw),
                  null,
                  2,
                )}
              </pre>
            </>
          ) : (
            <p>{t("conversation.noUsage")}</p>
          )}
        </Dialog>
      )}
      {zoom && (
        <Dialog title={t("conversation.zoomImage")} close={() => setZoom(null)} wide>
          <AttachmentImage key={zoom.id} className="zoom-image" image={zoom} eager />
        </Dialog>
      )}
    </section>
  );
}
