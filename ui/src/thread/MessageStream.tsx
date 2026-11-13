import { useNavigate } from "react-router";
// 消息流 —— 按轮收纳:
//   · 一条用户消息起一轮。轮内的思考 / 工具 / 中间文本是过程,最后那条正文是结果。
//   · 轮完成且有最终文本 → 过程整体收进「已工作X」折叠条,最终文本站在外面;
//   · 轮还在进行中(或没有最终文本,比如中途停掉)→ 平铺,过程依次展示;
//   · 用户消息是右侧灰底气泡;助理最终文本无气泡全宽 markdown,
//     悬停出现复制行,最后一条常显。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Icon, Mark, type IconName } from "../icons/Icon";
import { copyText } from "../lib/clipboard";
import { TurnEntries, TurnFold, Working, type TurnEntry } from "./Process";
import { dayLabel, renderMd } from "./format";
import { branchThread, loadOlder, retrySend, useThread } from "./store";
import { seedDraft } from "./draft";
import { buildRows, type Row, type UsageRecord } from "./thread";
import { Usage } from "./Usage";
import { AttachmentInfo } from "./AttachmentInfo";
import { Hint } from "../overlay/Hint";

/** 空白对话的起手式:每一条都是这个 Agent 真做得到的事。点了填进输入框,不直接发。 */
const STARTERS: Array<{
  icon: IconName;
  text: string;
  label: string;
}> = [
  {
    icon: "doc",
    label: "梳理项目",
    text: "看一下当前目录的结构,总结每个目录是干什么的",
  },
  {
    icon: "terminal",
    label: "检查环境",
    text: "检查这台机器的负载、内存和磁盘使用情况,有问题告诉我",
  },
  {
    icon: "pen",
    label: "整理文件",
    text: "把最近一天系统日志里的错误整理出来",
  },
];

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
    }
  | {
      kind: "flat";
      key: string;
      items: TurnEntry[];
    }
  | {
      kind: "turn";
      key: string;
      items: TurnEntry[];
      durationMs: number | null;
    };

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
          child.matches(".msg, .day-chip, .compaction") &&
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
      // 失败或空页没有插入历史，不留下会影响下一次滚动的恢复记录。
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
    // 仅在更早消息实际插入后恢复，流式增量和加载提示不会提前消耗锚点。
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
    let turnKey = "__head__";

    const noteAt = (at?: number) => {
      if (at) {
        turnLastAt = at;
      }
    };

    /**
     * 收掉当前这轮。live = 最后一轮且还在跑。
     * 有最终文本且已完成 → 过程进折叠条、最终文本在外;否则平铺。
     * 最终文本 = 轮里最后一条带正文的已完成 assistant 行。
     */
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
        output.push({
          kind: "flat",
          key: `flat:${turnKey}`,
          items: list,
        });
      } else {
        const final = list[finalIndex];
        const process = list.filter(
          (entry, index) => index !== finalIndex && entry.kind !== "usage",
        );
        const usage = list
          .filter((entry) => entry.kind === "usage" && entry.row.usageRecord)
          .map((entry) => entry.row.usageRecord!);
        if (process.length) {
          const durationMs =
            turnStartAt && turnLastAt && turnLastAt > turnStartAt ? turnLastAt - turnStartAt : null;
          output.push({
            kind: "turn",
            key: `turn:${turnKey}`,
            items: process,
            durationMs,
          });
        }
        output.push({
          kind: "message",
          key: final.row.key,
          row: final.row,
          final: true,
          usage,
        });
      }
      turnStartAt = undefined;
      turnLastAt = undefined;
    };

    for (const row of rows) {
      const day = dayLabel(row.at);
      if (day && day !== lastDay) {
        flushTurn(false); // 换天先收上一轮,日期条不站在折叠条中间
        output.push({
          kind: "day",
          key: `day:${row.key}`,
          label: day,
        });
        lastDay = day;
      }

      if (row.kind === "user") {
        flushTurn(false);
        turnKey = row.key;
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
        // 同一行可能既有思考又有正文 —— 思考属于过程,正文属于文本
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
      // 系统注解独立成块,不搅进轮里
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

  // 最后那条最终文本:复制行常显(其余悬停出现)
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
    // 正文在流式输出,或过程行自己带着扫光 —— 都轮不到等待动画
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

  // 依赖 currentId:内层容器按对话 key 重挂,换对话后要观察的是新节点 ——
  // 盯着旧节点的观察器一次都不会再触发,粘底从此失灵
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

  // 切对话 / 自己发消息:强制回底并重新粘上
  useEffect(() => {
    stick.current = true;
    setAtBottom(true);
    restoreFromTop.current = null;
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [viewSeq]);

  // 自动填屏:首页不满一屏就没有滚动条,onScroll 永不触发 —— 有更早的就继续拉
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

  return (
    <div className="stream-region">
      <main ref={scrollRef} className="stream" onScroll={onScroll}>
        {/* key 按对话换:换对话 = 整棵子树重挂,清除上一会话的组件状态 */}
        <div key={currentId || "__draft__"} ref={innerRef} className="stream-inner">
          {loadingOlder && <span className="chip">加载更早的消息…</span>}
          {!loadingOlder && hasMore && rows.length > 0 && (
            <button className="chip chip-btn" onClick={loadEarlier}>
              查看更早的消息
            </button>
          )}

          {!ready && !rows.length && <span className="chip">正在打开对话…</span>}

          {ready && !rows.length && (
            <div className="blank float-in">
              <Mark size={84} />
              <h1 className="blank-title">有什么可以帮你？</h1>
              <p className="blank-description">从一个问题、一份文件，或一个想法开始。</p>
              <div className="starters">
                {STARTERS.map((starter) => (
                  <button
                    key={starter.text}
                    className="starter"
                    onClick={() => seedDraft(starter.text)}
                  >
                    <span className="starter-ic">
                      <Icon name={starter.icon} size={15} />
                    </span>
                    <span className="starter-text">{starter.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {blocks.map((block) => {
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
                  <TurnFold id={block.key} durationMs={block.durationMs}>
                    <TurnEntries items={block.items} inFold />
                  </TurnFold>
                </div>
              );
            }

            const row = block.row;
            if (row.kind === "user") {
              return (
                <div key={block.key} className={`msg mine float-in`}>
                  <div className="bubble">
                    {row.attachments && row.attachments.length > 0 && (
                      <div className="message-attachments">
                        {row.attachments.map((file, index) =>
                          file.url ? (
                            <a
                              key={index}
                              className="attachment-card"
                              href={file.url}
                              download={file.name}
                              title={`下载 ${file.name}`}
                            >
                              <AttachmentInfo file={file} />
                            </a>
                          ) : (
                            <span key={index} className="attachment-card">
                              <AttachmentInfo file={file} />
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {row.images && row.images.length > 0 && (
                      <div className="message-files">
                        {row.images.map((src, index) => (
                          <img key={index} src={src} alt="图片" />
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
                      发送失败,点击重试
                    </button>
                  )}
                </div>
              );
            }
            if (row.kind === "assistant") {
              const always = block.key === lastFinalKey && !busy;
              const messageId = row.messageId;
              return (
                <div key={block.key} className={`msg agent float-in`}>
                  <span className="msg-avatar">
                    <Mark size={28} />
                  </span>
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(row.content) }} />
                  <Usage records={block.usage || []} />
                  <div className={`act-row${always ? " always" : ""}`}>
                    <Hint text="复制回答">
                      <button
                        className="act"
                        aria-label="复制回答"
                        onClick={() => void copyText(row.content)}
                      >
                        <Icon name="copy" size={16} />
                      </button>
                    </Hint>
                    {messageId !== undefined && messageId > 0 && !row.streaming && (
                      <Hint
                        text={
                          branchingMessageId === messageId ? "正在创建分支…" : "从此回答创建分支"
                        }
                      >
                        <button
                          className="act"
                          aria-label="分支"
                          aria-busy={branchingMessageId === messageId}
                          disabled={busy || branchingMessageId > 0}
                          onClick={async () => {
                            const id = await branchThread(messageId);
                            if (id) {
                              navigate(`/sessions/${id}`);
                            }
                          }}
                        >
                          <Icon name="branch" size={16} />
                        </button>
                      </Hint>
                    )}
                  </div>
                </div>
              );
            }
            if (row.code === "compacted" && row.content) {
              return (
                <details key={block.key} className="compaction">
                  <summary>已压缩早期对话</summary>
                  <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(row.content) }} />
                  {row.usageRecord && <Usage records={[row.usageRecord]} />}
                </details>
              );
            }
            if (row.code === "error") {
              return (
                <div key={block.key} className="stream-error" role="alert">
                  <Icon name="alert" size={18} />
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
    </div>
  );
}
