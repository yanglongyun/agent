import type { ReactNode } from "react";
import { AppSwitcher } from "./AppSwitcher";

// 非对话应用共用的顶栏：左侧返回或标题，右侧自己的操作和应用面板。
export function AppBar({
  title,
  subtitle,
  leading,
  actions,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      {leading}
      <div className="topbar-main">
        <span className="topbar-title clip">{title}</span>
        {subtitle && <span className="topbar-sub">{subtitle}</span>}
      </div>
      <div className="topbar-actions">
        {actions}
        <AppSwitcher />
      </div>
    </header>
  );
}
