import { create } from "zustand";
const WIDTH = "agent.sidebar.width";
const FOLD = "agent.sidebar.folded";
const NARROW = matchMedia("(max-width: 860px)");
let folded: Record<string, boolean> = {};
try {
  folded = JSON.parse(localStorage.getItem(FOLD) || "{}");
} catch {}
const width = Number(localStorage.getItem(WIDTH));
export const useShell = create<{
  mobile: boolean;
  sidebarOpen: boolean;
  collapsed: boolean;
  sidebarWidth: number | null;
  folded: Record<string, boolean>;
  setSidebarWidth(px: number): void;
  closeSidebar(): void;
  toggleCollapsed(): void;
  openMenu(): void;
  toggleFold(id: string): void;
}>((set, get) => ({
  mobile: NARROW.matches,
  sidebarOpen: false,
  collapsed: false,
  sidebarWidth: width > 0 ? width : null,
  folded,
  setSidebarWidth: (px) => {
    const value = Math.min(440, Math.max(200, px));
    localStorage.setItem(WIDTH, String(value));
    set({ sidebarWidth: value });
  },
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleCollapsed: () => set({ collapsed: !get().collapsed }),
  openMenu: () => (NARROW.matches ? set({ sidebarOpen: true }) : set({ collapsed: false })),
  toggleFold: (id) => {
    const next = { ...get().folded, [id]: !get().folded[id] };
    localStorage.setItem(FOLD, JSON.stringify(next));
    set({ folded: next });
  },
}));
NARROW.addEventListener("change", (event) =>
  useShell.setState({ mobile: event.matches, sidebarOpen: false }),
);
