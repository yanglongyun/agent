import { useRef, useState } from "react";
import { useLocation } from "@/lib/router";
import { Icon } from "@/icons/Icon";
import { SideGroup } from "./SideGroup";
import { useShell } from "@/app/layout";
import { reorderPinned, setPinned, useConversation, type Conversation } from "@/chat/store";
import {
  clearDragVisuals,
  hideDropLine,
  markDropTarget,
  moveDragChip,
  showDropLine,
} from "./dragVisuals";
import { useT } from "@/i18n";
const SLOP = 4;
type Drag = {
  id: string;
  from: number;
  startY: number;
  scroll: HTMLElement | null;
  moved: boolean;
  target:
    | {
        pin: true;
        index: number;
      }
    | {
        pin: false;
      }
    | null;
};
export function useConversationGroups({
  onRename,
  onRemove,
  onPick,
}: {
  onRename: (conversation: Conversation) => void;
  onRemove: (conversation: Conversation) => void;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const { conversations, currentId } = useConversation();
  const live = new Set(
    conversations
      .filter((conversation) => conversation.running)
      .map((conversation) => conversation.id),
  );
  const onConversationPage = useLocation().pathname === "/conversation";
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const pinned = conversations.filter((conversation) => Boolean(conversation.pinned));
  const recent = conversations.filter((conversation) => !conversation.pinned);
  const folded = useShell((state) => state.folded);
  const shownPinned = folded.pinned ? [] : pinned;
  const shownRecent = folded.recent ? [] : recent;
  const ordered = [...shownPinned, ...shownRecent];
  const pinnedOffset = 0;
  const sectionAt = (x: number, y: number, scroll: HTMLElement | null) => {
    const viewport = scroll?.getBoundingClientRect();
    if (
      !viewport ||
      x < viewport.left ||
      x > viewport.right ||
      y < viewport.top ||
      y > viewport.bottom
    ) {
      return null;
    }
    for (const id of ["pinned", "recent"] as const) {
      const rect = scroll?.querySelector(`[data-group="${id}"]`)?.getBoundingClientRect();
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id;
      }
    }
    return null;
  };
  const onDown = (event: React.PointerEvent<HTMLElement>, index: number) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".conv-ops")) {
      return;
    }
    suppressClick.current = false;
    const scroll = (event.currentTarget as HTMLElement).closest<HTMLElement>(".side-scroll");
    const nodes = [...(scroll?.querySelectorAll<HTMLElement>(".conv") ?? [])];
    const rect = nodes[index]?.getBoundingClientRect();
    if (!rect || nodes.length !== ordered.length) {
      return;
    }
    drag.current = {
      id: ordered[index].id,
      from: index,
      startY: event.clientY,
      scroll,
      moved: false,
      target: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) {
      return;
    }
    if (!state.moved && Math.abs(event.clientY - state.startY) < SLOP) {
      return;
    }
    if (!state.moved) {
      state.moved = true;
      setDragging(true);
    }
    const title = ordered[state.from]?.title || t("conversation.untitled");
    moveDragChip(title, event.clientX, event.clientY);
    const section = sectionAt(event.clientX, event.clientY, state.scroll);
    if (!section) {
      state.target = null;
      hideDropLine();
      markDropTarget(null);
      return;
    }
    if (section === "recent") {
      state.target = { pin: false };
      hideDropLine();
      markDropTarget(state.scroll?.querySelector('[data-group="recent"]') ?? null);
      return;
    }
    markDropTarget(null);
    const rows: DOMRect[] = [];
    for (let index = 0; index < shownPinned.length; index += 1) {
      const at = pinnedOffset + index;
      if (at !== state.from) {
        rows.push(state.scroll!.querySelectorAll<HTMLElement>(".conv")[at].getBoundingClientRect());
      }
    }
    let slot = 0;
    for (const rect of rows) {
      if (rect.top + rect.height / 2 < event.clientY) {
        slot += 1;
      }
    }
    state.target = { pin: true, index: slot };
    const box = state.scroll?.querySelector('[data-group="pinned"]')?.getBoundingClientRect();
    if (!rows.length || !box) {
      hideDropLine();
      markDropTarget(state.scroll?.querySelector('[data-group="pinned"]') ?? null);
      return;
    }
    const y = slot < rows.length ? rows[slot].top - 1 : rows[rows.length - 1].bottom + 1;
    showDropLine(box.left + 6, y, box.width - 12);
  };
  const cancelDrag = () => {
    suppressClick.current = Boolean(drag.current?.moved);
    drag.current = null;
    setDragging(false);
    clearDragVisuals();
  };
  const onUp = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.moved) {
      onMove(event);
    }
    const state = drag.current;
    suppressClick.current = Boolean(state?.moved);
    drag.current = null;
    setDragging(false);
    if (!state) {
      return;
    }
    clearDragVisuals();
    if (!state.moved || !state.target) {
      return;
    }
    const wasPinned = Boolean(
      conversations.find((conversation) => conversation.id === state.id)?.pinned,
    );
    if (!state.target.pin) {
      if (wasPinned) {
        void setPinned(state.id, false);
      }
      return;
    }
    const rest = pinned
      .filter((conversation) => conversation.id !== state.id)
      .map((conversation) => conversation.id);
    rest.splice(Math.min(state.target.index, rest.length), 0, state.id);
    if (wasPinned) {
      void reorderPinned(rest);
    } else {
      void setPinned(state.id, true, rest);
    }
  };
  const row = (conversation: Conversation, index: number) => {
    const alive = live.has(conversation.id);
    return (
      <div
        key={conversation.id}
        className={[
          "conv",
          onConversationPage && conversation.id === currentId ? "on" : "",
          drag.current?.moved && drag.current.id === conversation.id ? "dragging" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onPointerDown={(event) => onDown(event, index)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={() => {
          if (drag.current) {
            cancelDrag();
          }
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onClick={() => {
          if (!drag.current?.moved) {
            onPick(conversation.id);
          }
        }}
      >
        {alive && (
          <span className="conv-mark">
            <i className="conv-live" title={t("conversation.stillRunning")} />
          </span>
        )}
        <button
          className="conv-title ellipsis"
          onClick={(event) => {
            event.stopPropagation();
            onPick(conversation.id);
          }}
        >
          {conversation.title || t("conversation.untitled")}
        </button>
        <span
          className="conv-ops"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className={`op${Boolean(conversation.pinned) ? " pinned" : ""}`}
            title={Boolean(conversation.pinned) ? t("conversation.unpin") : t("conversation.pin")}
            onClick={() => void setPinned(conversation.id, !conversation.pinned)}
          >
            <Icon name={Boolean(conversation.pinned) ? "starFill" : "star"} size={14} />
          </button>
          <button
            className="op"
            title={t("conversation.rename")}
            onClick={() => onRename(conversation)}
          >
            <Icon name="pencil" size={14} />
          </button>
          <button
            className="op danger"
            title={t("common.delete")}
            onClick={() => onRemove(conversation)}
          >
            <Icon name="trash" size={14} />
          </button>
        </span>
      </div>
    );
  };
  const pinnedEl =
    pinned.length > 0 || dragging ? (
      <div
        key="pinned"
        className={`side-history${dragging ? " dragging" : ""}`}
        data-group="pinned"
      >
        <SideGroup id="pinned" label={t("conversation.pinnedLabel")} gap>
          {shownPinned.length === 0 && dragging && (
            <div className="pin-empty">{t("conversation.dropToPin")}</div>
          )}
          {shownPinned.map((conversation, index) => row(conversation, pinnedOffset + index))}
        </SideGroup>
      </div>
    ) : null;
  const recentEl =
    recent.length > 0 ? (
      <div
        key="recent"
        className={`side-history${dragging ? " dragging" : ""}`}
        data-group="recent"
      >
        <SideGroup id="recent" label={t("conversation.recentLabel")} gap>
          {shownRecent.map((conversation, index) => row(conversation, shownPinned.length + index))}
        </SideGroup>
      </div>
    ) : null;
  return { pinnedEl, recentEl };
}
