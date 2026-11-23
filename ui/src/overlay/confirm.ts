// 网页与桌面共用的确认弹窗。
//   if (!(await confirmDialog({ title: '删除对话', message: '…', danger: true }))) return;
import { create } from "zustand";
import { t } from "@/i18n";

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  danger: boolean;
};

let resolver: ((ok: boolean) => void) | null = null;

export const useConfirm = create<ConfirmState>(() => ({
  open: false,
  title: "",
  message: "",
  confirmText: t("common.confirm"),
  danger: false,
}));

export function confirmDialog({
  title = t("confirm.title"),
  message = "",
  confirmText = t("common.confirm"),
  danger = false,
} = {}) {
  resolver?.(false); // 罕见的叠开:上一个按「取消」收掉
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
    useConfirm.setState({ open: true, title, message, confirmText, danger });
  });
}

export function settleConfirm(ok: boolean) {
  useConfirm.setState({ open: false });
  resolver?.(ok);
  resolver = null;
}
