import { useState, type ReactNode } from "react";
import { fmtArgs, fmtResult, renderMd } from "./format";
import type { Row } from "./thread";
import { Icon } from "@/icons/Icon";
import { t as tt, useT } from "@/i18n";
import type { TurnEntry } from "./turns";
const basename = (value: unknown) =>
  String(value ?? "")
    .split("/")
    .filter(Boolean)
    .pop() || "";
function toolMeta(row: Row): {
  icon: ReactNode;
  label: string;
  pill: string;
  pillWide: boolean;
} {
  const args = (row.args || {}) as Record<string, unknown>;
  const summary = String(args.summary ?? "");
  switch (row.name) {
    case "read":
      return {
        icon: <Icon name="read" size={15} />,
        label: tt("tool.read"),
        pill: basename(args.path) || summary,
        pillWide: false,
      };
    case "write":
      return {
        icon: <Icon name="edit" size={13} />,
        label: tt("tool.write"),
        pill: basename(args.path) || summary,
        pillWide: false,
      };
    case "edit":
      return {
        icon: <Icon name="edit" size={13} />,
        label: tt("tool.edit"),
        pill: basename(args.path) || summary,
        pillWide: false,
      };
    case "shell":
      return {
        icon: <Icon name="terminal" size={15} />,
        label: tt("tool.shell"),
        pill: summary || String(args.command ?? ""),
        pillWide: true,
      };
    case "stdio":
      return {
        icon: <Icon name="terminal" size={15} />,
        label: tt("tool.stdio"),
        pill: summary,
        pillWide: true,
      };
    case "agent":
      return {
        icon: <Icon name="branch" size={15} />,
        label: tt("tool.agent"),
        pill: summary || String(args.task ?? ""),
        pillWide: true,
      };
    default:
      return {
        icon: <Icon name="terminal" size={15} />,
        label: row.name || "tool",
        pill: summary,
        pillWide: true,
      };
  }
}
function isFailed(row: Row) {
  if (row.failed) {
    return true;
  }
  if (!row.result) {
    return false;
  }
  try {
    return Boolean(JSON.parse(row.result)?.error);
  } catch {
    return false;
  }
}
const isThinkingNow = (row: Row) => Boolean(row.streaming && !row.content);
function ProcIconSlot({ icon }: { icon: ReactNode }) {
  return (
    <span className="pi">
      <span className="pi-glyph">{icon}</span>
      <span className="pi-chev">
        <Icon name="chevronRight" size={12} />
      </span>
    </span>
  );
}
export function ThinkItem({ row, compact }: { row: Row; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className={`pc${open ? " open" : ""}${compact ? " sm" : ""}`}>
      <button className="pc-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ProcIconSlot icon={<Icon name="think" size={compact ? 12 : 14} />} />
        <span className="pc-label">
          <i>{isThinkingNow(row) ? t("conversation.thinking") : t("proc.think")}</i>
        </span>
      </button>
      {open && (
        <div className="pc-blocks">
          <div className="expand-block">{row.reasoning}</div>
        </div>
      )}
    </div>
  );
}
export function ToolItem({ row, compact }: { row: Row; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const meta = toolMeta(row);
  const running = row.status === "running";
  const failed = isFailed(row);
  const canExpand = !running;
  return (
    <div className={`pc${open ? " open" : ""}${compact ? " sm" : ""}${failed ? " faded" : ""}`}>
      <button
        className="pc-head"
        aria-expanded={open}
        disabled={!canExpand}
        onClick={() => canExpand && setOpen(!open)}
      >
        <ProcIconSlot icon={meta.icon} />
        <span className="pc-label">
          <i className={running ? "shimmer" : undefined}>{meta.label}</i>
          {meta.pill && (
            <span className="tpill" style={meta.pillWide ? { maxWidth: 250 } : undefined}>
              <span>{meta.pill}</span>
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="pc-blocks">
          <div className="expand-block">{fmtArgs(row.args)}</div>
          <div className="expand-block">
            {row.result ? fmtResult(row.result) : t("tool.noOutput")}
          </div>
          {row.images?.map((url) => (
            <img className="pc-image" key={url} src={url} alt={meta.label} />
          ))}
        </div>
      )}
    </div>
  );
}
type GroupKind = "create" | "edit" | "read" | "exec";
function groupKind(row: Row): GroupKind {
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
function groupCount(rows: Row[]) {
  const paths = new Set<string>();
  for (const row of rows) {
    const path = String((row.args as Record<string, unknown> | undefined)?.path ?? "").trim();
    paths.add(path || row.callId || "");
  }
  return paths.size;
}
const GROUP_LABELS: Record<
  GroupKind,
  "proc.group.create" | "proc.group.edit" | "proc.group.read" | "proc.group.exec"
> = {
  create: "proc.group.create",
  edit: "proc.group.edit",
  read: "proc.group.read",
  exec: "proc.group.exec",
};
function groupSummary(rows: Row[]): string {
  const kinds: GroupKind[] = ["create", "edit", "read", "exec"];
  const parts: string[] = [];
  for (const kind of kinds) {
    const matching = rows.filter((row) => groupKind(row) === kind);
    if (!matching.length) {
      continue;
    }
    parts.push(tt(GROUP_LABELS[kind], { n: groupCount(matching) }));
  }
  return parts.join(", ");
}
function groupIcon(rows: Row[]): ReactNode {
  const pick =
    rows.find((row) => groupKind(row) === "edit") ||
    rows.find((row) => groupKind(row) === "create") ||
    rows.find((row) => groupKind(row) === "read") ||
    rows[0];
  return toolMeta(pick).icon;
}
function ToolGroupItem({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const faded = rows.every(isFailed);
  return (
    <div className={`pc${open ? " open" : ""}${faded ? " faded" : ""}`}>
      <button className="pc-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ProcIconSlot icon={groupIcon(rows)} />
        <span className="pc-label">
          <i>{groupSummary(rows)}</i>
        </span>
      </button>
      {open && (
        <div className="pc-group-body">
          {rows.map((row) => (
            <ToolItem key={row._key} row={row} compact />
          ))}
        </div>
      )}
    </div>
  );
}
function formatDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
}
export function TurnCollapse({
  durationMs,
  children,
}: {
  durationMs: number | null;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label =
    durationMs != null && durationMs > 0
      ? t("proc.workedFor", { duration: formatDuration(durationMs) })
      : t("proc.pastRun");
  return (
    <div className={`turn${open ? " open" : ""}`}>
      <button className="turn-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="turn-row">
          <span className="turn-label">{label}</span>
          <span className="turn-chev">
            <Icon name="chevronRightMedium" size={12} />
          </span>
        </span>
        <span className="turn-line" />
      </button>
      {open && <div className="turn-body">{children}</div>}
    </div>
  );
}
export function TurnEntries({ items, inTurn }: { items: TurnEntry[]; inTurn?: boolean }) {
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
        <ToolGroupItem key={`group:${rows[0]._key}`} rows={rows} />
      ) : (
        <ToolItem key={rows[0]._key} row={rows[0]} />
      ),
    );
  };
  for (const item of items) {
    if (item.kind === "tool") {
      if (item.row.status === "running") {
        flushTools();
        nodes.push(<ToolItem key={item.row._key} row={item.row} />);
      } else {
        pendingTools.push(item.row);
      }
      continue;
    }
    flushTools();
    if (item.kind === "think") {
      nodes.push(<ThinkItem key={`think:${item.row._key}`} row={item.row} />);
    } else {
      nodes.push(
        <div
          key={`text:${item.row._key}`}
          className="md"
          dangerouslySetInnerHTML={{ __html: renderMd(item.row.content) }}
        />,
      );
    }
  }
  flushTools();
  if (inTurn) {
    return <>{nodes}</>;
  }
  return (
    <>
      {nodes.map((node, index) => (
        <div key={index} className="cmsg relay">
          {node}
        </div>
      ))}
    </>
  );
}
export function WorkingStatus() {
  const t = useT();
  return (
    <div className="working shimmer" role="status">
      {t("conversation.working")}
    </div>
  );
}
