// 壳布局:列表栏收起(宽屏)与抽屉(窄屏)。收起是长期偏好,跨启动记住。
import { useEffect, useState } from "react";
import { create } from "zustand";

const KEY = "agent.sidebar.collapsed";
const NARROW = "(max-width: 760px)";
const saved = (key: string) => {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};
const savedCollapsed = () => saved(KEY) === "1";

interface ShellState {
  /** 宽屏下侧栏是否收起。 */
  collapsed: boolean;
  /** 窄屏抽屉是否拉开(宽屏下无效,由样式裁决)。 */
  drawer: boolean;
  toggleCollapsed: () => void;
  openSidebar: () => void;
  closeDrawer: () => void;
}

export const useShell = create<ShellState>((set) => ({
  collapsed: savedCollapsed(),
  drawer: false,
  toggleCollapsed: () =>
    set((state) => {
      const collapsed = !state.collapsed;
      try {
        localStorage.setItem(KEY, collapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
      return {
        collapsed,
        drawer: false,
      };
    }),
  // 顶栏菜单键:宽屏 = 展开,窄屏 = 拉抽屉。两个状态一起给,样式各取所需
  openSidebar: () =>
    set(() => {
      try {
        localStorage.setItem(KEY, "0");
      } catch {
        /* ignore */
      }
      return {
        collapsed: false,
        drawer: window.matchMedia(NARROW).matches,
      };
    }),
  closeDrawer: () => set({ drawer: false }),
}));

/** 窄屏：导航栏和列表栏收进抽屉，舞台铺满。 */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
