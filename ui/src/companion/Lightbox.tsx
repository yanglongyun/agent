import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { Icon } from "../icons/Icon";

// 全局唯一的大图查看层：点击聊天或动态里的照片打开，Escape 或点击空白处关闭。
const useLightbox = create<{ src: string | null; caption: string }>(() => ({
  src: null,
  caption: "",
}));

export function viewImage(src: string, caption = "") {
  useLightbox.setState({ src, caption });
}

export function Lightbox() {
  const { src, caption } = useLightbox();
  return (
    <Dialog.Root
      open={Boolean(src)}
      onOpenChange={(open) => {
        if (!open) {
          useLightbox.setState({ src: null, caption: "" });
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="cp-lightbox-veil" />
        <Dialog.Content className="cp-lightbox" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">查看照片</Dialog.Title>
          <Dialog.Close className="icon-btn cp-lightbox-close" aria-label="关闭">
            <Icon name="close" size={20} />
          </Dialog.Close>
          {src && (
            <Dialog.Close asChild>
              <img src={src} alt={caption} />
            </Dialog.Close>
          )}
          {caption && <p>{caption}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
