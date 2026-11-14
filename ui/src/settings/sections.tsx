import type { ReactNode } from "react";
import { create } from "zustand";
import type { IconName } from "../icons/Icon";

// 设置页的分区。列表栏按它列出导航，页面按它排版，滚动时高亮当前分区。
export const sections: Array<{ id: string; name: string; icon: IconName }> = [
  { id: "models", name: "模型", icon: "cpu" },
  { id: "instructions", name: "指令", icon: "doc" },
  { id: "compression", name: "上下文压缩", icon: "shrink" },
  { id: "execution", name: "执行环境", icon: "terminal" },
  { id: "appearance", name: "外观", icon: "palette" },
  { id: "service", name: "服务", icon: "server" },
  { id: "about", name: "关于", icon: "info" },
  { id: "account", name: "账户", icon: "key" },
];

export const useSettingsNav = create<{ active: string }>(() => ({ active: sections[0].id }));

export function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" id={id}>
      <header className="settings-section-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** 卡片里的一行：左边名称和说明，右边控件；stack 时控件换到下一行占满宽度。 */
export function SettingRow({
  label,
  note,
  stack,
  children,
}: {
  label: string;
  note?: string;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`setting-row${stack ? " stack" : ""}`}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {note && <span className="setting-note">{note}</span>}
      </span>
      <span className="setting-control">{children}</span>
    </label>
  );
}
