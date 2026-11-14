import * as Dialog from "@radix-ui/react-dialog";
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { LogsPane } from "../logs/LogsPane";
import { NotesPane } from "../notes/NotesPane";
import { SettingsPane } from "../settings/SettingsPane";
import { appForPath } from "./apps";
import { ChatPane } from "./ChatPane";
import { useNarrow, useShell } from "./layout";
import { Rail } from "./Rail";

function paneFor(appId: string) {
  switch (appId) {
    case "logs":
      return <LogsPane />;
    case "notes":
      return <NotesPane />;
    case "settings":
      return <SettingsPane />;
    default:
      return <ChatPane />;
  }
}

// 所有页面共用的外壳：应用导航 + 当前应用的列表栏 + 舞台。
// 宽屏三栏并排，列表栏可收起；窄屏导航和列表栏一起收进左侧抽屉。
export function Frame() {
  const shell = useShell();
  const narrow = useNarrow();
  const location = useLocation();
  const app = appForPath(location.pathname);
  const pane = paneFor(app.id);

  useEffect(() => {
    if (!narrow) {
      useShell.getState().closeDrawer();
    }
  }, [narrow]);

  return (
    <>
      {!narrow && <Rail />}
      {!narrow && (
        <aside className={`pane${shell.collapsed ? " folded" : ""}`} aria-label={app.name}>
          {pane}
        </aside>
      )}
      <Outlet />
      <Dialog.Root
        open={narrow && shell.drawer}
        onOpenChange={(open) => {
          if (!open) {
            shell.closeDrawer();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="drawer-veil" />
          <Dialog.Content
            className="drawer"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              document.querySelector<HTMLButtonElement>(".menu-btn")?.focus();
            }}
          >
            <Dialog.Title className="sr-only">导航</Dialog.Title>
            <Rail onHome={shell.closeDrawer} />
            <div className="pane">{pane}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
