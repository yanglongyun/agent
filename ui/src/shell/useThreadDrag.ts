// 侧栏会话的拖拽：拖入置顶组、在置顶组内排序、拖到其余会话区域取消置顶。
// 鼠标移动超过阈值即开始；触屏需要长按，这样普通滑动仍然是滚动列表。
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  clearDragVisuals,
  hideDropLine,
  markDropTarget,
  moveDragChip,
  showDropLine,
} from "./dragVisuals";
import { nextPinnedIds, samePinnedIds, type DropTarget } from "./pinned";

const MOUSE_THRESHOLD = 4; // 鼠标移动超过这个距离才算拖拽，避免误伤点击
const LONG_PRESS_MS = 380; // 触屏按住这么久才进入拖拽
const TOUCH_SLOP = 8; // 长按等待期间手指移动超过这个距离，视为在滚动列表，放弃拖拽
const EDGE = 44; // 指针靠近列表上下边缘这么近时自动滚动
const MAX_SCROLL_SPEED = 14; // 自动滚动每帧最大像素

interface DragState {
  id: string;
  title: string;
  element: HTMLElement;
  scroll: HTMLElement | null;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  timer: number | null;
  target: DropTarget | null;
}

function contains(box: DOMRect, x: number, y: number) {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

export function useThreadDrag({
  enabled,
  pinnedIds,
  onChange,
}: {
  enabled: boolean;
  pinnedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef(0);
  const latest = useRef({ pinnedIds, onChange });
  latest.current = { pinnedIds, onChange };
  const [draggingId, setDraggingId] = useState("");

  function finish() {
    const state = drag.current;
    if (!state) {
      return;
    }
    if (state.timer !== null) {
      window.clearTimeout(state.timer);
    }
    window.cancelAnimationFrame(frame.current);
    if (state.active) {
      // 松手后浏览器还会补发一次 click，吞掉它，避免拖完就跳转。
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 80);
    }
    drag.current = null;
    setDraggingId("");
    clearDragVisuals();
  }

  // 触屏拖拽进行时必须拦住浏览器滚动。iOS 要求不可取消默认行为的 touchmove 监听
  // 在手指按下之前就已注册，所以常驻在 document 上，只在拖拽激活时才拦截。
  useEffect(() => {
    const block = (event: TouchEvent) => {
      if (drag.current?.active && event.cancelable) {
        event.preventDefault();
      }
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      document.removeEventListener("touchmove", block);
      finish();
    };
  }, []);

  function updateTarget(state: DragState) {
    state.target = null;
    hideDropLine();
    markDropTarget(null);
    const scroll = state.scroll;
    if (!scroll || !contains(scroll.getBoundingClientRect(), state.x, state.y)) {
      return;
    }
    const pinGroup = scroll.querySelector<HTMLElement>('[data-group="pinned"]');
    const recentGroup = scroll.querySelector<HTMLElement>('[data-group="recent"]');
    if (pinGroup && contains(pinGroup.getBoundingClientRect(), state.x, state.y)) {
      const rows = Array.from(pinGroup.querySelectorAll<HTMLElement>(".conv"))
        .filter((row) => row.dataset.threadId !== state.id)
        .map((row) => row.getBoundingClientRect());
      let index = 0;
      for (const box of rows) {
        if (state.y > box.top + box.height / 2) {
          index += 1;
        }
      }
      state.target = { kind: "pinned", index };
      if (rows.length === 0) {
        markDropTarget(pinGroup);
        return;
      }
      const group = pinGroup.getBoundingClientRect();
      const y = index < rows.length ? rows[index].top : rows[rows.length - 1].bottom;
      showDropLine(group.left + 6, y, group.width - 12);
      return;
    }
    if (recentGroup && contains(recentGroup.getBoundingClientRect(), state.x, state.y)) {
      state.target = { kind: "recent" };
      // 只有拖的是置顶会话时，落到这里才有意义（取消置顶），才高亮。
      if (latest.current.pinnedIds.includes(state.id)) {
        markDropTarget(recentGroup);
      }
    }
  }

  function autoScroll() {
    const state = drag.current;
    if (!state || !state.active || !state.scroll) {
      return;
    }
    const view = state.scroll.getBoundingClientRect();
    let speed = 0;
    if (state.y < view.top + EDGE) {
      speed = -Math.min(MAX_SCROLL_SPEED, ((view.top + EDGE - state.y) / EDGE) * MAX_SCROLL_SPEED);
    } else if (state.y > view.bottom - EDGE) {
      speed = Math.min(
        MAX_SCROLL_SPEED,
        ((state.y - (view.bottom - EDGE)) / EDGE) * MAX_SCROLL_SPEED,
      );
    }
    if (speed !== 0) {
      state.scroll.scrollTop += speed;
      updateTarget(state);
    }
    frame.current = window.requestAnimationFrame(autoScroll);
  }

  function activate(state: DragState) {
    state.active = true;
    setDraggingId(state.id);
    try {
      state.element.setPointerCapture(state.pointerId);
    } catch {
      /* 指针已经结束，无需捕获 */
    }
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(12);
    }
    moveDragChip(state.title, state.x, state.y);
    updateTarget(state);
    frame.current = window.requestAnimationFrame(autoScroll);
  }

  function bind(thread: { id: string; title: string }) {
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!enabled || event.button !== 0) {
          return;
        }
        if (event.target instanceof Element && event.target.closest(".conv-menu")) {
          return;
        }
        finish();
        const state: DragState = {
          id: thread.id,
          title: thread.title,
          element: event.currentTarget,
          scroll: event.currentTarget.closest<HTMLElement>(".side-scroll"),
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          active: false,
          timer: null,
          target: null,
        };
        drag.current = state;
        if (event.pointerType !== "mouse") {
          state.timer = window.setTimeout(() => {
            state.timer = null;
            if (drag.current === state) {
              activate(state);
            }
          }, LONG_PRESS_MS);
        }
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const state = drag.current;
        if (!state || event.pointerId !== state.pointerId) {
          return;
        }
        state.x = event.clientX;
        state.y = event.clientY;
        if (!state.active) {
          const distance = Math.hypot(state.x - state.startX, state.y - state.startY);
          if (state.pointerType === "mouse") {
            if (distance >= MOUSE_THRESHOLD) {
              activate(state);
            }
          } else if (distance > TOUCH_SLOP) {
            finish();
          }
          return;
        }
        moveDragChip(state.title, state.x, state.y);
        updateTarget(state);
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const state = drag.current;
        if (!state || event.pointerId !== state.pointerId) {
          return;
        }
        const wasActive = state.active;
        if (wasActive) {
          state.x = event.clientX;
          state.y = event.clientY;
          updateTarget(state);
        }
        const target = state.target;
        finish();
        if (!wasActive || !target) {
          return;
        }
        const current = latest.current.pinnedIds;
        const next = nextPinnedIds(current, state.id, target);
        if (!samePinnedIds(next, current)) {
          latest.current.onChange(next);
        }
      },
      onPointerCancel() {
        finish();
      },
      onContextMenu(event: { preventDefault: () => void }) {
        // 触屏长按会弹出系统菜单，会打断拖拽。
        if (drag.current && drag.current.pointerType !== "mouse") {
          event.preventDefault();
        }
      },
    };
  }

  function consumeClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return true;
    }
    return false;
  }

  return { draggingId, bind, consumeClick };
}
