import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/icons/Icon";
import { useT } from "@/i18n";
export function Dialog({
  title,
  close,
  children,
  wide = false,
  className = "",
  dismissible = true,
}: {
  title: string;
  close(): void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  dismissible?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current!;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`modal${wide ? " modal-wide" : ""}${className ? ` ${className}` : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) {
          close();
        }
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            close();
          }
        }
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2 className="modal-title">{title}</h2>
        {dismissible && (
          <button className="icon-btn" aria-label={t("common.close")} onClick={close}>
            <Icon name="close" size={17} />
          </button>
        )}
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
