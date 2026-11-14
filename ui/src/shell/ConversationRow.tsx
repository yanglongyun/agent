import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { PointerEvent } from "react";
import { Link } from "react-router";
import { Icon } from "../icons/Icon";
import { threadTitle, type Thread } from "../thread/store";

export interface RowGestures {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
}

// 侧栏里的一行会话：点击进入，长按/拖动排序，菜单里重命名、置顶、删除。
export function ConversationRow({
  thread,
  active,
  live,
  pinned,
  dragging,
  gestures,
  consumeClick,
  onNavigate,
  onRename,
  onRemove,
  onTogglePin,
  onMenuTrigger,
}: {
  thread: Thread;
  active: boolean;
  live: boolean;
  pinned: boolean;
  dragging: boolean;
  gestures: RowGestures;
  consumeClick: () => boolean;
  onNavigate: () => void;
  onRename: (thread: Thread) => void;
  onRemove: (thread: Thread) => void;
  onTogglePin: (thread: Thread) => void;
  onMenuTrigger: (element: HTMLButtonElement) => void;
}) {
  const title = threadTitle(thread);
  const classes = ["row", "conv"];
  if (active) {
    classes.push("on");
  }
  if (dragging) {
    classes.push("dragging");
  }
  return (
    <div className={classes.join(" ")} data-thread-id={thread.id} {...gestures}>
      <Link
        className="conv-title"
        to={`/sessions/${thread.id}`}
        draggable={false}
        onClick={(event) => {
          if (consumeClick()) {
            event.preventDefault();
            return;
          }
          onNavigate();
        }}
        title={title}
      >
        {pinned && <Icon name="pin" size={13} className="conv-pin" />}
        {live && <span className="conv-live" aria-label="正在运行" />}
        <span className="clip">{title}</span>
      </Link>
      <Dropdown.Root>
        <Dropdown.Trigger
          className="conv-menu icon-btn sm"
          onFocus={(event) => onMenuTrigger(event.currentTarget)}
          onPointerDown={(event) => onMenuTrigger(event.currentTarget)}
          aria-label={`对话操作：${title}`}
        >
          <Icon name="more" size={16} />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            className="dropdown-content"
            align="start"
            side="bottom"
            sideOffset={6}
            collisionPadding={12}
          >
            <Dropdown.Item className="dropdown-item" onSelect={() => onTogglePin(thread)}>
              <Icon name={pinned ? "pinOff" : "pin"} size={15} />
              {pinned ? "取消置顶" : "置顶"}
            </Dropdown.Item>
            <Dropdown.Item className="dropdown-item" onSelect={() => onRename(thread)}>
              <Icon name="pen" size={15} />
              重命名
            </Dropdown.Item>
            <Dropdown.Separator className="dropdown-separator" />
            <Dropdown.Item className="dropdown-item danger" onSelect={() => onRemove(thread)}>
              <Icon name="trash" size={15} />
              删除对话
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </div>
  );
}
