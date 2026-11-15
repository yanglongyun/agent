import { useNavigate } from "react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { Icon, Mark } from "../icons/Icon";
import { copyText } from "../lib/clipboard";
import { toast } from "../overlay/toast";
import { Hint } from "../overlay/Hint";
import { Sheet } from "../overlay/Sheet";
import { AttachmentInfo } from "./AttachmentInfo";
import { renderMd } from "./format";
import { usageSummary } from "./metering";
import { buildBlocks } from "./blocks";
import { TurnCollapse, TurnEntries, Working } from "./Process";
import { branchThread, loadOlder, retrySend, useThread } from "./store";
import { buildRows, type Row, type UsageRecord } from "./thread";

// 每条回答下面直接显示三个图标：复制、从此处创建分支、用量与费用信息。
function AssistantActions({
  row,
  usage,
  busy,
  branchingMessageId,
  onBranch,
  onOpenUsage,
}: {
  row: Row;
  usage: UsageRecord[];
  busy: boolean;
  branchingMessageId: number;
  onBranch: (messageId: number) => void;
  onOpenUsage: (records: UsageRecord[]) => void;
}) {
  const messageId = row.messageId;
  const canBranch = messageId !== undefined && messageId > 0 && !row.streaming;
  const branching = messageId !== undefined && branchingMessageId === messageId;

  return (
    <div className="act-row">
      <Hint text="复制回答">
        <button
          type="button"
          className="act"
          aria-label="复制回答"
          onClick={() => {
            void copyText(row.content);
            toast("已复制");
          }}
        >
          <Icon name="copy" size={15} />
        </button>
      </Hint>
      {canBranch && (
        <Hint text={branching ? "正在创建分支…" : "从此处创建分支"}>
          <button
            type="button"
            className="act"
            aria-label="从此处创建分支"
            disabled={busy || branchingMessageId > 0}
            onClick={() => onBranch(messageId)}
          >
            <Icon name="branch" size={15} />
          </button>
        </Hint>
      )}
      {usage.length > 0 && (
        <Hint text="用量与费用">
          <button
            type="button"
            className="act"
            aria-label="用量与费用"
            onClick={() => onOpenUsage(usage)}
          >
            <Icon name="info" size={15} />
          </button>
        </Hint>
      )}
    </div>
  );
}

export function MessageStream() {
  const navigate = useNavigate();
  const showCreatedSession = (id: string) => {
    if (window.location.pathname === "/") {
      navigate(`/sessions/${id}`, { replace: true });
    }
  };
  const {
    messages,
    compactions,
    notes,
    busy,
    ready,
    hasMore,
    loadingOlder,
    viewSeq,
    currentId,
    branchingMessageId,
  } = useThread();
  const rows = useMemo(
    () => [...buildRows(messages, compactions, busy), ...notes],
    [messages, compactions, busy, notes],
  );
  const scrollRef = useRef<HTMLElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const innerRef = useRef<HTMLDivElement>(null);

  const [usageModal, setUsageModal] = useState<UsageRecord[] | null>(null);
  const [compactionModal, setCompactionModal] = useState<Row | null>(null);

  // 「粘底」:贴着底部时任何高度变化都跟着走;用户上滚就不打扰,滚回底部重新粘上
  const stick = useRef(true);
  const restoreFromTop = useRef<{
    sessionId: string;
    firstId: number;
    node: Element | null;
    offset: number;
    height: number;
    top: number;
  } | null>(null);

  const loadEarlier = () => {
    const element = scrollRef.current;
    const first = messages.find((message) => message.id > 0);
    if (!element || !first || !hasMore || useThread.getState().loadingOlder) {
      return;
    }
    const node =
      Array.from(innerRef.current?.children || []).find(
        (child) =>
          child.matches(".msg, .day-chip, .chip") &&
          child.getBoundingClientRect().bottom > element.getBoundingClientRect().top,
      ) || null;
    const anchor = {
      sessionId: currentId,
      firstId: first.id,
      node,
      offset: node?.getBoundingClientRect().top || 0,
      height: element.scrollHeight,
      top: element.scrollTop,
    };
    stick.current = false;
    restoreFromTop.current = anchor;
    void loadOlder().finally(() => {
      if (
        restoreFromTop.current === anchor &&
        useThread.getState().messages.find((message) => message.id > 0)?.id === anchor.firstId
      ) {
        restoreFromTop.current = null;
      }
    });
  };

  useLayoutEffect(() => {
    const anchor = restoreFromTop.current;
    const element = scrollRef.current;
    if (!anchor || !element) {
      return;
    }
    if (anchor.sessionId !== currentId) {
      restoreFromTop.current = null;
      return;
    }
    if (messages.find((message) => message.id > 0)?.id === anchor.firstId) {
      return;
    }
    if (anchor.node?.isConnected && element.contains(anchor.node)) {
      element.scrollTop += anchor.node.getBoundingClientRect().top - anchor.offset;
    } else {
      element.scrollTop = anchor.top + element.scrollHeight - anchor.height;
    }
    restoreFromTop.current = null;
  }, [currentId, messages]);

  const blocks = useMemo(() => buildBlocks(rows, busy), [rows, busy]);

  const showWorking = useMemo(() => {
    if (!busy) {
      return false;
    }
    // 用量行跟在最后一项后面，判断时跳过。
    let last: Row | undefined;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].kind !== "usage") {
        last = rows[i];
        break;
      }
    }
    // 正文正在流式输出，或工具自己带着扫光时，不再额外显示「正在处理」。
    if (last && last.kind === "assistant" && last.streaming && last.content) {
      return false;
    }
    if (last && last.kind === "tool" && last.status === "running") {
      return false;
    }
    return true;
  }, [busy, rows]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAtBottom(stick.current);
    if (element.scrollTop < 60 && hasMore && !loadingOlder) {
      loadEarlier();
    }
  };

  useEffect(() => {
    const element = scrollRef.current;
    const inner = innerRef.current;
    if (!element || !inner) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (restoreFromTop.current) {
        restoreFromTop.current.height = element.scrollHeight;
        restoreFromTop.current.top = element.scrollTop;
      } else if (stick.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [currentId]);

  useEffect(() => {
    stick.current = true;
    setAtBottom(true);
    restoreFromTop.current = null;
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [viewSeq]);

  useEffect(() => {
    if (!ready || !hasMore || loadingOlder || !rows.length) {
      return;
    }
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    if (element.scrollHeight <= element.clientHeight + 40) {
      void loadOlder();
    }
  }, [ready, hasMore, loadingOlder, rows.length]);

  const usageInfo = usageModal ? usageSummary(usageModal) : null;

  // 代码块标题行里的「复制」按钮由这里统一处理：正文是渲染好的 HTML，没有各自的事件。
  const copyCodeBlock = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("[data-copy-code]");
    if (!button) {
      return;
    }
    const code = button.closest(".code-block")?.querySelector("pre code");
    void copyText(code?.textContent || "");
    toast("代码已复制");
  };

  return (
    <div className="stream-region">
      <main ref={scrollRef} className="stream" onScroll={onScroll}>
        <div
          key={currentId || "__draft__"}
          ref={innerRef}
          className="stream-inner"
          onClick={copyCodeBlock}
        >
          {loadingOlder && <span className="chip">加载更早的消息…</span>}
          {!loadingOlder && hasMore && rows.length > 0 && (
            <button className="chip chip-btn" onClick={loadEarlier}>
              查看更早的消息
            </button>
          )}

          {!ready && !rows.length && <span className="chip">正在打开对话…</span>}

          {ready && !rows.length && (
            <div className="blank float-in">
              <Mark size={52} />
              <h1 className="blank-title">有什么可以帮你？</h1>
              <p className="blank-description">在这台机器上执行命令、读写文件，把事情做完。</p>
            </div>
          )}

          {blocks.map((block, index) => {
            if (block.kind === "day") {
              return (
                <span key={block.key} className="day-chip">
                  {block.label}
                </span>
              );
            }

            if (block.kind === "flat") {
              return <TurnEntries key={block.key} items={block.items} />;
            }
            if (block.kind === "turn") {
              return (
                <div key={block.key} className="msg agent">
                  <TurnCollapse id={block.key} durationMs={block.durationMs}>
                    <TurnEntries items={block.items} inFold />
                  </TurnCollapse>
                </div>
              );
            }

            const row = block.row;
            const prev = blocks[index - 1];
            const next = blocks[index + 1];
            const samePrev = prev?.kind === "message" && prev.row.kind === row.kind;
            const sameNext = next?.kind === "message" && next.row.kind === row.kind;

            if (row.kind === "user") {
              const hasText = Boolean(row.content);
              const onlyImages =
                !hasText &&
                Boolean(row.images && row.images.length > 0) &&
                (!row.attachments || row.attachments.length === 0);
              let groupClass = "";
              if (samePrev && sameNext) {
                groupClass = " is-mid";
              } else if (samePrev) {
                groupClass = " is-end";
              } else if (sameNext) {
                groupClass = " is-start";
              }
              return (
                <div key={block.key} className={`msg mine${groupClass} float-in`}>
                  <div className={`bubble${onlyImages ? " is-media" : ""}`}>
                    {row.attachments && row.attachments.length > 0 && (
                      <div className="message-attachments">
                        {row.attachments.map((file, fileIndex) =>
                          file.url ? (
                            <a
                              key={fileIndex}
                              className="attachment-card"
                              href={file.url}
                              download={file.name}
                              title={`下载 ${file.name}`}
                            >
                              <AttachmentInfo file={file} />
                            </a>
                          ) : (
                            <span key={fileIndex} className="attachment-card">
                              <AttachmentInfo file={file} />
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {row.images && row.images.length > 0 && (
                      <div className="message-files">
                        {row.images.map((src, imgIndex) => (
                          <img key={imgIndex} src={src} alt="图片" />
                        ))}
                      </div>
                    )}
                    {row.content}
                  </div>
                  {row.sending && <div className="send-state">发送中…</div>}
                  {!row.sending && row.failed && (
                    <button
                      className="send-retry"
                      onClick={() => void retrySend(row, showCreatedSession)}
                    >
                      未送达 · 点击重试
                    </button>
                  )}
                </div>
              );
            }

            if (row.kind === "assistant") {
              return (
                <div key={block.key} className="msg agent float-in">
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(row.content) }} />
                  {!row.streaming && (
                    <AssistantActions
                      row={row}
                      usage={block.usage || []}
                      busy={busy}
                      branchingMessageId={branchingMessageId}
                      onBranch={async (messageId) => {
                        const id = await branchThread(messageId);
                        if (id) {
                          navigate(`/sessions/${id}`);
                        }
                      }}
                      onOpenUsage={(records) => setUsageModal(records)}
                    />
                  )}
                </div>
              );
            }

            if (row.code === "compacted" && row.content) {
              return (
                <button
                  key={block.key}
                  type="button"
                  className="chip chip-btn"
                  onClick={() => setCompactionModal(row)}
                >
                  <Icon name="shrink" size={12} />
                  已压缩早期对话
                </button>
              );
            }

            if (row.code === "error") {
              return (
                <div key={block.key} className="stream-error" role="alert">
                  <Icon name="alert" size={17} />
                  <div>
                    <strong>本次回复未完成</strong>
                    <p>{row.content}</p>
                  </div>
                </div>
              );
            }

            return (
              <span key={block.key} className="chip">
                {row.code === "stopped" ? "已停止" : row.content}
              </span>
            );
          })}

          {showWorking && (
            <div className="msg agent float-in">
              <Working />
            </div>
          )}
        </div>
      </main>

      {!atBottom && rows.length > 0 && (
        <Hint text="回到最新消息">
          <button
            className="scroll-latest"
            aria-label="回到最新消息"
            onClick={() => {
              stick.current = true;
              setAtBottom(true);
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            <Icon name="down" size={17} />
          </button>
        </Hint>
      )}

      {usageModal && usageInfo && (
        <Sheet title="用量与费用" className="wide" onClose={() => setUsageModal(null)}>
          <div className="usage-cost">
            <span className="usage-cost-label">消耗金额</span>
            <strong className="usage-cost-amount">
              {usageInfo.costs.length > 0 ? usageInfo.costs.join(" · ") : "未计费"}
            </strong>
            {usageInfo.costs.length > 0 && usageInfo.missing > 0 && (
              <span className="usage-cost-note">另有 {usageInfo.missing} 次请求未计费</span>
            )}
          </div>
          <div className="pill-row">
            <span className="pill">{usageModal.length} 次请求</span>
            {usageInfo.tokens.map((item) => (
              <span key={item} className="pill">
                {item}
              </span>
            ))}
          </div>
          <pre className="well sheet-well">
            {JSON.stringify(
              usageModal.map((record) => record.usage),
              null,
              2,
            )}
          </pre>
        </Sheet>
      )}

      {compactionModal && (
        <Sheet title="上下文压缩摘要" className="wide" onClose={() => setCompactionModal(null)}>
          <div
            className="md"
            dangerouslySetInnerHTML={{ __html: renderMd(compactionModal.content || "") }}
          />
          {compactionModal.usageRecord && (
            <pre className="well sheet-well">
              {JSON.stringify(usageSummary([compactionModal.usageRecord]).raw, null, 2)}
            </pre>
          )}
        </Sheet>
      )}
    </div>
  );
}
