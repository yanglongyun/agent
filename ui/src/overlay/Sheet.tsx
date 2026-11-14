import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { Icon } from "../icons/Icon";

// Radix 负责模态、焦点约束、Escape 和背景滚动锁定。
export function Sheet({
  title,
  onClose,
  children,
  className = "",
  footer,
  returnFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  returnFocus?: HTMLElement | null;
}) {
  const origin = useRef(returnFocus ?? document.activeElement);
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="veil" />
        <Dialog.Content
          ref={content}
          className={`sheet ${className}${footer ? " sheet-with-footer" : ""}`}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // 有输入框就聚焦输入框；否则聚焦弹窗本身，不让关闭按钮一打开就带着焦点环。
            event.preventDefault();
            const field = content.current?.querySelector<HTMLInputElement>("[data-autofocus]");
            if (field) {
              field.focus();
              field.select();
            } else {
              content.current?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (origin.current instanceof HTMLElement && origin.current.isConnected) {
              origin.current.focus({ preventScroll: true });
            }
          }}
        >
          <header className="sheet-head">
            <Dialog.Title className="sheet-title">{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="关闭">
              <Icon name="close" size={18} />
            </Dialog.Close>
          </header>
          <div className="sheet-body">{children}</div>
          {footer && <footer className="sheet-footer">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
