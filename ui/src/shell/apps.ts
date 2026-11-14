// 应用面板里的应用。对话只是其中一个，日志和设置同级。
import type { IconName } from "../icons/Icon";

export interface AppInfo {
  id: "chat" | "logs" | "settings";
  name: string;
  icon: IconName;
  path: string;
  /** 这些路径前缀属于该应用，用来判断当前在哪个应用里。 */
  prefixes: string[];
}

export const apps: AppInfo[] = [
  { id: "chat", name: "对话", icon: "messages", path: "/", prefixes: ["/sessions"] },
  { id: "logs", name: "日志", icon: "logs", path: "/logs", prefixes: ["/logs"] },
  { id: "settings", name: "设置", icon: "settings", path: "/settings", prefixes: ["/settings"] },
];

/** 严格匹配：不属于任何应用的地址（比如 404 页）返回 null。 */
export function matchApp(pathname: string): AppInfo | null {
  if (pathname === "/") {
    return apps[0];
  }
  for (const app of apps) {
    for (const prefix of app.prefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + "/")) {
        return app;
      }
    }
  }
  return null;
}

/** 当前应用；没有匹配的页面按对话处理。 */
export function appForPath(pathname: string): AppInfo {
  return matchApp(pathname) ?? apps[0];
}

// 记住每个应用最后停留的页面：从日志切回对话时回到刚才那个对话，而不是新对话。
const lastPaths = new Map<AppInfo["id"], string>();

export function rememberLocation(location: string) {
  const app = matchApp(location.split("?")[0]);
  if (app) {
    lastPaths.set(app.id, location);
  }
}

export function launchPath(app: AppInfo) {
  return lastPaths.get(app.id) ?? app.path;
}
