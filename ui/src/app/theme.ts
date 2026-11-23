import { create } from "zustand";
const KEY = "agent.theme";
const system = matchMedia("(prefers-color-scheme: dark)");
export const THEMES = ["sky", "night", "system"] as const;
type Theme = (typeof THEMES)[number];
function load(): Theme {
  const value = localStorage.getItem(KEY);
  return THEMES.includes(value as Theme) ? (value as Theme) : "system";
}
export function applyTheme(theme: Theme) {
  const dark = theme === "night" || (theme === "system" && system.matches);
  document.documentElement.dataset.theme = dark ? "night" : "sky";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
export const useTheme = create<{ theme: Theme; setTheme(value: Theme): void }>((set) => ({
  theme: load(),
  setTheme(value) {
    localStorage.setItem(KEY, value);
    applyTheme(value);
    set({ theme: value });
  },
}));
system.addEventListener("change", () => {
  if (useTheme.getState().theme === "system") {
    applyTheme("system");
  }
});
