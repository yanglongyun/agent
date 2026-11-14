import { Link, useLocation } from "react-router";
import { Icon, Mark, type IconName } from "../icons/Icon";
import { cycleTheme, useTheme, type ThemeMode } from "../lib/theme";
import { Hint } from "../overlay/Hint";
import { createDraft } from "../thread/store";
import { appForPath, apps, launchPath, type AppInfo } from "./apps";

const themes: Record<ThemeMode, { icon: IconName; label: string }> = {
  auto: { icon: "monitor", label: "主题：跟随系统" },
  light: { icon: "sun", label: "主题：浅色" },
  dark: { icon: "moon", label: "主题：深色" },
};

function RailLink({ app, current }: { app: AppInfo; current: boolean }) {
  return (
    <Hint text={app.name} side="right">
      <Link
        to={launchPath(app)}
        className={`rail-item${current ? " current" : ""}`}
        aria-label={app.name}
        aria-current={current ? "page" : undefined}
      >
        <Icon name={app.icon} size={20} />
      </Link>
    </Hint>
  );
}

// 最左侧的应用导航：对话、日志在上，主题和设置在下。所有页面共用同一条。
// 切换应用后列表栏跟着换，抽屉里也一样，所以只有回到新对话时才通知关闭抽屉。
export function Rail({ onHome }: { onHome?: () => void }) {
  const location = useLocation();
  const current = appForPath(location.pathname);
  const mode = useTheme((state) => state.mode);
  const theme = themes[mode];
  const primary = apps.filter((app) => app.id !== "settings");
  const settings = apps.filter((app) => app.id === "settings");
  return (
    <nav className="rail" aria-label="应用">
      <Link
        to="/"
        className="rail-brand"
        aria-label="新对话"
        onClick={() => {
          if (location.pathname === "/") {
            createDraft();
          }
          onHome?.();
        }}
      >
        <Mark size={32} />
      </Link>
      <div className="rail-group">
        {primary.map((app) => (
          <RailLink key={app.id} app={app} current={app.id === current.id} />
        ))}
      </div>
      <span className="grow" />
      <div className="rail-group">
        <Hint text={theme.label} side="right">
          <button type="button" className="rail-item" aria-label={theme.label} onClick={cycleTheme}>
            <Icon name={theme.icon} size={19} />
          </button>
        </Hint>
        {settings.map((app) => (
          <RailLink key={app.id} app={app} current={app.id === current.id} />
        ))}
      </div>
    </nav>
  );
}
