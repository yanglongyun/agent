import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useNavigate } from "react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { Icon, Mark } from "../icons/Icon";
import { copyText } from "../lib/clipboard";
import { toast } from "../overlay/toast";
import { Hint } from "../overlay/Hint";
import { Sheet } from "../overlay/Sheet";
import { AttachmentInfo } from "./AttachmentInfo";
import { dayLabel, formatDuration, renderMd } from "./format";
import { usageSummary } from "./metering";
import { TurnEntries, Working, type TurnEntry } from "./Process";
import { branchThread, loadOlder, retrySend, useThread } from "./store";
import { buildRows, type Row, type UsageRecord } from "./thread";

type Block =
  | {
      kind: "day";
      key: string;
      label: string;
    }
  | {
      kind: "message";
      key: string;
      row: Row;
      final?: boolean;
      usage?: UsageRecord[];
      process?: TurnEntry[];
      durationMs?: number | null;
    };

function AssistantActions({
  row,
  always,
  usage,
  process,
  durationMs,
  busy,
  branchingMessageId,
  onBranch,
  onOpenUsage,
  onOpenProcess,
}: {
  row: Row;
  always: boolean;
  usage: UsageRecord[];
  process: TurnEntry[];
  durationMs: number | null;
  busy: boolean;
  branchingMessageId: number;
  onBranch: (messageId: number) => void;
  onOpenUsage: (records: UsageRecord[]) => void;
  onOpenProcess: (items: TurnEntry[], durationMs: number | null) => void;
}) {
  const messageId = row.messageId;
  const canBranch = messageId !== undefined && messageId > 0 && !row.streaming;
  const hasMore = canBranch || usage.length > 0 || process.length > 0;

  return (
    <div className={`act-row${always ? " always" : ""}`}>
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
      {hasMore && (
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button type="button" className="act" aria-label="更多操作">
              <Icon name="more" size={15} />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              className="dropdown-content msg-more-menu"
              align="start"
              sideOffset={6}
              collisionPadding={12}
            >
              {canBranch && (
                <Dropdown.Item
                  className="dropdown-item"
                  disabled={busy || branchingMessageId > 0}
                  onSelect={() => onBranch(messageId)}
                >
                  <Icon name="branch" size={15} />
                  <span>
                    {branchingMessageId === messageId ? "正在创建分支…" : "从此处创建分支"}
                  </span>
                </Dropdown.Item>
              )}
              {usage.length > 0 && (
                <Dropdown.Item className="dropdown-item" onSelect={() => onOpenUsage(usage)}>
                  <Icon name="layers" size={15} />
                  <span>用量与费用</span>
                </Dropdown.Item>
              )}
              {process.length > 0 && (
                <Dropdown.Item
                  className="dropdown-item"
                  onSelect={() => onOpenProcess(process, durationMs)}
                >
                  <Icon name="terminal" size={15} />
                  <span>执行过程（{process.length} 步）</span>
                </Dropdown.Item>
              )}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
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
  const [processModal, setProcessModal] = useState<{
    items: TurnEntry[];
    durationMs: number | null;
  } | null>(null);
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

  const blocks = useMemo<Block[]>(() => {
    const output: Block[] = [];
    let lastDay = "";

    let entries: TurnEntry[] = [];
    let turnStartAt: number | undefined;
    let turnLastAt: number | undefined;

    const noteAt = (at?: number) => {
      if (at) {
        turnLastAt = at;
      }
    };

    // 主对话只呈现对用户的消息回复；思考、工具调用与用量收进该回复的「更多」详情中。
    const flushTurn = (live: boolean) => {
      if (!entries.length) {
        turnStartAt = undefined;
        turnLastAt = undefined;
        return;
      }
      const list = entries;
      entries = [];

      let finalIndex = -1;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].kind === "text" && !list[i].row.streaming) {
          finalIndex = i;
          break;
        }
      }
      if (live || finalIndex < 0) {
        for (const item of list) {
          if (item.kind === "text" && item.row.content) {
            output.push({
              kind: "message",
              key: item.row.key,
              row: item.row,
            });
          }
        }
      } else {
        const final = list[finalIndex];
        const process = list.filter(
          (entry, index) => index !== finalIndex && entry.kind !== "usage",
        );
        const usage = list
          .filter((entry) => entry.kind === "usage" && entry.row.usageRecord)
          .map((entry) => entry.row.usageRecord!);
        const durationMs =
          turnStartAt && turnLastAt && turnLastAt > turnStartAt ? turnLastAt - turnStartAt : null;
        output.push({
          kind: "message",
          key: final.row.key,
          row: final.row,
          final: true,
          usage,
          process,
          durationMs,
        });
      }
      turnStartAt = undefined;
      turnLastAt = undefined;
    };

    for (const row of rows) {
      const day = dayLabel(row.at);
      if (day && day !== lastDay) {
        flushTurn(false);
        output.push({
          kind: "day",
          key: `day:${row.key}`,
          label: day,
        });
        lastDay = day;
      }

      if (row.kind === "user") {
        flushTurn(false);
        turnStartAt = row.at;
        output.push({
          kind: "message",
          key: row.key,
          row,
        });
        continue;
      }
      if (row.kind === "tool") {
        entries.push({
          kind: "tool",
          row,
        });
        noteAt(row.at);
        continue;
      }
      if (row.kind === "usage") {
        entries.push({ kind: "usage", row });
        continue;
      }
      if (row.kind === "assistant") {
        if (row.reasoning) {
          entries.push({
            kind: "think",
            row,
          });
        }
        if (row.content) {
          entries.push({
            kind: "text",
            row,
          });
        }
        noteAt(row.at);
        continue;
      }
      flushTurn(false);
      output.push({
        kind: "message",
        key: row.key,
        row,
      });
    }
    flushTurn(busy);
    return output;
  }, [rows, busy]);

  const lastFinalKey = useMemo(() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i];
      if (block.kind === "message" && block.final) {
        return block.key;
      }
    }
    return "";
  }, [blocks]);

  const showWorking = useMemo(() => {
    if (!busy) {
      return false;
    }
    const last = rows[rows.length - 1];
    // 只有当正文正在流式输出时才隐藏打字动画；工具执行或思考期间都展示打字气泡。
    if (last && last.kind === "assistant" && last.streaming && last.content) {
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
              const always = block.key === lastFinalKey && !busy;
              return (
                <div key={block.key} className="msg agent float-in">
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(row.content) }} />
                  {!row.streaming && (
                    <AssistantActions
                      row={row}
                      always={always}
                      usage={block.usage || []}
                      process={block.process || []}
                      durationMs={block.durationMs ?? null}
                      busy={busy}
                      branchingMessageId={branchingMessageId}
                      onBranch={async (messageId) => {
                        const id = await branchThread(messageId);
                        if (id) {
                          navigate(`/sessions/${id}`);
                        }
                      }}
                      onOpenUsage={(records) => setUsageModal(records)}
                      onOpenProcess={(items, durationMs) => setProcessModal({ items, durationMs })}
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
          <div className="pill-row">
            {usageInfo.tokens.map((item) => (
              <span key={item} className="pill">
                {item}
              </span>
            ))}
            {usageModal.length > 1 && <span className="pill">{usageModal.length} 次请求</span>}
            {usageInfo.costs.map((cost) => (
              <span key={cost} className="pill is-accent">
                {cost}
              </span>
            ))}
          </div>
          <pre className="well sheet-well">{JSON.stringify(usageInfo.raw, null, 2)}</pre>
        </Sheet>
      )}

      {processModal && (
        <Sheet
          title={
            processModal.durationMs != null && processModal.durationMs > 0
              ? `执行过程 · ${formatDuration(processModal.durationMs)}`
              : "执行过程"
          }
          className="wide"
          onClose={() => setProcessModal(null)}
        >
          <div className="process-list">
            <TurnEntries items={processModal.items} inFold />
          </div>
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
