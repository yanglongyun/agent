// 过程体系:思考 / 工具各是一行(图标位悬停换 chevron,展开转 90°),
// 相邻的已完成工具收成一行摘要。主对话不直接显示过程,只在回答的「更多 → 执行过程」
// 弹窗和子任务详情里出现;运行中的工具标签走扫光。
import { type ReactNode } from "react";

import { Icon } from "../icons/Icon";
import { fmtArgs, fmtResult, isFailed, renderMd, toolMeta } from "./format";
import { useThread } from "./store";
import type { Row } from "./thread";
import { Usage } from "./Usage";

// 展开状态属于当前会话，列表分组和刷新不会丢失。
function useExpanded(key: string): [boolean, (open: boolean) => void] {
  const open = useThread((state) => state.expanded[key] === true);
  const setOpen = (value: boolean) =>
    useThread.setState((state) => ({ expanded: { ...state.expanded, [key]: value } }));
  return [open, setOpen];
}

/** 一轮里按序排布的条目:过程(思考 / 工具)与中间文本。 */
export type TurnEntry = {
  kind: "think" | "tool" | "text" | "usage";
  row: Row;
};

/* ── 行骨架:图标位(图形 ⇄ chevron)+ 标签,思考与工具共用 ── */

function StepIcon({ icon }: { icon: ReactNode }) {
  return (
    <span className="step-ic">
      <span className="step-glyph">{icon}</span>
      <span className="step-chev">
        <Icon name="chev" size={12} />
      </span>
    </span>
  );
}

/* ── 思考条目 ── */

export function ThinkItem({ row, compact }: { row: Row; compact?: boolean }) {
  const [open, setOpen] = useExpanded(row.key);
  const thinking = Boolean(row.streaming && !row.content);
  return (
    <div className={`step${open ? " open" : ""}${compact ? " sm" : ""}`}>
      <button className="step-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepIcon icon={<Icon name="spark" size={compact ? 12 : 14} />} />
        <span className="step-label">
          <i className={thinking ? "sheen" : undefined}>{thinking ? "思考中" : "已思考"}</i>
        </span>
      </button>
      {open && (
        <div className="step-body">
          <div className="well step-block">{row.reasoning}</div>
        </div>
      )}
    </div>
  );
}

/* ── 工具条目 ── */

export function ToolItem({ row, compact }: { row: Row; compact?: boolean }) {
  const [open, setOpen] = useExpanded(row.key);
  const meta = toolMeta(row);
  const running = row.status === "running";
  const failed = isFailed(row);
  return (
    <div className={`step${open ? " open" : ""}${compact ? " sm" : ""}${failed ? " faded" : ""}`}>
      <button
        className="step-head"
        aria-expanded={open}
        disabled={running}
        onClick={() => !running && setOpen(!open)}
      >
        <StepIcon icon={meta.icon} />
        <span className="step-label">
          <i className={running ? "sheen" : undefined}>{meta.label}</i>
          {meta.pill && (
            <span className="step-pill" style={meta.pillWide ? { maxWidth: 260 } : undefined}>
              <span>{meta.pill}</span>
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="step-body">
          <div className="well step-block">{fmtArgs(row.args)}</div>
          <div className="well step-block">{row.result ? fmtResult(row.result) : "没有输出"}</div>
          {row.images && row.images.length > 0 && (
            <div className="message-files">
              {row.images.map((src, index) => (
                <img key={index} src={src} alt="工具读取的图片" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 相邻已完成工具 ≥2 收成一行摘要 ── */

type GroupKind = "create" | "edit" | "read" | "exec" | "delegate" | "task";

function groupKind(row: Row): GroupKind {
  if (row.name === "agent") {
    return row.args?.action === "start" ? "delegate" : "task";
  }
  if (row.name === "read") {
    return "read";
  }
  if (row.name === "write") {
    return "create";
  }
  if (row.name === "edit") {
    return "edit";
  }
  return "exec";
}

/** 文件类按去重后的路径数计,执行类按次数计。 */
function groupCount(rows: Row[], kind: GroupKind) {
  if (["exec", "delegate", "task"].includes(kind)) {
    return rows.length;
  }
  const paths = new Set<string>();
  for (const row of rows) {
    paths.add(String(row.args?.path ?? "").trim() || row.callId || "");
  }
  return paths.size;
}

const GROUP_TEXT: Record<GroupKind, (n: number) => string> = {
  create: (n) => `写入了 ${n} 个文件`,
  edit: (n) => `修改了 ${n} 个文件`,
  read: (n) => `读取了 ${n} 个文件`,
  exec: (n) => `执行了 ${n} 条命令`,
  delegate: (n) => `启动了 ${n} 个子任务`,
  task: (n) => `执行了 ${n} 次任务操作`,
};

function groupSummary(rows: Row[]) {
  const parts: string[] = [];
  for (const kind of ["create", "edit", "read", "exec", "delegate", "task"] as GroupKind[]) {
    const matching = rows.filter((row) => groupKind(row) === kind);
    if (matching.length) {
      parts.push(GROUP_TEXT[kind](groupCount(matching, kind)));
    }
  }
  return parts.join(",");
}

/** 分组头部图标:取代表(edit > create > read > exec)。 */
function groupIcon(rows: Row[]) {
  const pick =
    rows.find((row) => groupKind(row) === "edit") ||
    rows.find((row) => groupKind(row) === "create") ||
    rows.find((row) => groupKind(row) === "read") ||
    rows[0];
  return toolMeta(pick).icon;
}

export function ToolGroup({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useExpanded(`group:${rows[0].key}`);
  const faded = rows.every(isFailed);
  return (
    <div className={`step${open ? " open" : ""}${faded ? " faded" : ""}`}>
      <button className="step-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepIcon icon={groupIcon(rows)} />
        <span className="step-label">
          <i>{groupSummary(rows)}</i>
        </span>
      </button>
      {open && (
        <div className="step-group">
          {rows.map((row) => (
            <ToolItem key={row.key} row={row} compact />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 有序渲染一串条目:过程做相邻分组,中间文本按 markdown 平铺 ──
   inFold=true 时条目裸排(外层容器自带 gap);否则每条包一层消息行。 */

export function TurnEntries({ items, inFold }: { items: TurnEntry[]; inFold?: boolean }) {
  const nodes: ReactNode[] = [];
  let pendingTools: Row[] = [];

  const flushTools = () => {
    if (!pendingTools.length) {
      return;
    }
    const rows = pendingTools;
    pendingTools = [];
    nodes.push(
      rows.length >= 2 ? (
        <ToolGroup key={`g:${rows[0].key}`} rows={rows} />
      ) : (
        <ToolItem key={rows[0].key} row={rows[0]} />
      ),
    );
  };

  for (const item of items) {
    if (item.kind === "tool") {
      // 运行中的工具单独显示
      if (item.row.status === "running") {
        flushTools();
        nodes.push(<ToolItem key={item.row.key} row={item.row} />);
      } else {
        pendingTools.push(item.row);
      }
      continue;
    }
    flushTools();
    if (item.kind === "usage" && item.row.usageRecord) {
      nodes.push(<Usage key={item.row.key} records={[item.row.usageRecord]} />);
    } else if (item.kind === "think") {
      nodes.push(<ThinkItem key={`t:${item.row.key}`} row={item.row} />);
    } else {
      nodes.push(
        <div
          key={`x:${item.row.key}`}
          className={`md`}
          dangerouslySetInnerHTML={{ __html: renderMd(item.row.content) }}
        />,
      );
    }
  }
  flushTools();

  if (inFold) {
    return <>{nodes}</>;
  }
  return (
    <>
      {nodes.map((node, index) => (
        <div key={index} className="msg agent">
          {node}
        </div>
      ))}
    </>
  );
}

/* ── 正在回复：品牌色的呼吸光点 + 扫光文字 ── */

export function Working() {
  return (
    <div className="working" role="status" aria-label="正在回复">
      <span className="working-orb" aria-hidden="true" />
      <span className="sheen">正在处理…</span>
    </div>
  );
}
