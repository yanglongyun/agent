import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Icon } from "../icons/Icon";
import { appForPath, apps, launchPath } from "./apps";

// 右上角的应用面板：点开后是一排应用，当前应用高亮。
export function AppSwitcher() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = appForPath(location.pathname);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn app-switch-btn" aria-label="应用">
          <Icon name="grid" size={19} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="app-panel"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="应用"
        >
          {apps.map((app) => (
            <Link
              key={app.id}
              to={launchPath(app)}
              className={`app-tile app-${app.id}${app.id === current.id ? " current" : ""}`}
              aria-current={app.id === current.id ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="app-tile-icon">
                <Icon name={app.icon} size={24} />
              </span>
              <span className="app-tile-name">{app.name}</span>
            </Link>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
