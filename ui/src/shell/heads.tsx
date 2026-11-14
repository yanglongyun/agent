import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { useShell } from "./layout";

// 列表栏的标题行：应用名 + 自己的操作 + 收起（抽屉里是关闭）。
export function PaneHead({ title, children }: { title: string; children?: ReactNode }) {
  const shell = useShell();
  return (
    <div className="pane-head">
      <h2 className="pane-title">{title}</h2>
      <span className="grow" />
      {children}
      {shell.drawer ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭导航"
          onClick={shell.closeDrawer}
        >
          <Icon name="close" size={18} />
        </button>
      ) : (
        <Hint text="收起侧栏">
          <button
            type="button"
            className="icon-btn"
            aria-label="收起侧栏"
            onClick={shell.toggleCollapsed}
          >
            <Icon name="panelClose" size={18} />
          </button>
        </Hint>
      )}
    </div>
  );
}

// 舞台的标题行：左侧是展开列表栏的按钮、标题和状态，右侧是当前页面的操作。
export function StageHead({
  title,
  leading,
  meta,
  children,
}: {
  title: string;
  leading?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const shell = useShell();
  return (
    <header className="stage-head">
      <button
        type="button"
        className={`icon-btn menu-btn${shell.collapsed ? " show" : ""}`}
        aria-label="展开侧栏"
        onClick={shell.openSidebar}
      >
        <Icon name="panel" size={18} />
      </button>
      {leading}
      <div className="stage-title">
        <h1 className="clip">{title}</h1>
        {meta}
      </div>
      <div className="stage-actions">{children}</div>
    </header>
  );
}
