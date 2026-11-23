import { useEffect, useState } from "react";
import type { ImageAttachment } from "./thread";
import { useT } from "@/i18n";

// 本地图片用对象地址，已保存的图片直接引用服务端地址（同源 Cookie 鉴权）。
export function AttachmentImage({
  image,
  onLoad,
  eager = false,
  className,
}: {
  image: ImageAttachment;
  onLoad?: () => void;
  eager?: boolean;
  className?: string;
}) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState(() => (image.source.kind === "url" ? image.source.url : ""));
  useEffect(() => {
    if (image.source.kind !== "local") {
      setSrc(image.source.url);
      return;
    }
    const url = URL.createObjectURL(image.source.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  return (
    <img
      className={`attachment-image${className ? ` ${className}` : ""}`}
      src={src || undefined}
      alt={failed ? t("conversation.imageLoadFailed") : image.name}
      onLoad={onLoad}
      onError={() => setFailed(true)}
      loading={eager ? "eager" : "lazy"}
      data-loading={!src && !failed}
    />
  );
}
