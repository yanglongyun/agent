import { create } from "zustand";

type ToastState = {
  message: string;
  show: (message: string, duration?: number) => void;
};

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: "",
  show(message, duration = 1600) {
    set({ message });
    clearTimeout(timer);
    timer = setTimeout(() => set({ message: "" }), duration);
  },
}));

// 非组件环境（引擎、API 层）直接弹一条提示。
export const toast = (message: string, duration?: number) =>
  useToast.getState().show(message, duration);
