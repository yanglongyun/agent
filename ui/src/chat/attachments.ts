import type { Attachment } from "./thread";

// 与服务端同一组限制：合计 5 个、50 MiB；图片单张 10 MiB，文件单个 25 MiB。
export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export const isImage = (
  attachment: Attachment,
): attachment is Extract<Attachment, { kind: "image" }> => attachment.kind === "image";

export async function saveClipboardFiles(files: File[]): Promise<Attachment[]> {
  return files.slice(0, MAX_ATTACHMENTS).map((file) => {
    const image = IMAGE_TYPES.includes(file.type);
    if (file.size > (image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) {
      throw new Error(image ? "单张图片不能超过 10 MiB" : "单个附件不能超过 25 MiB");
    }
    const base = {
      id: crypto.randomUUID(),
      name: file.name || "图片",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    };
    return image
      ? { ...base, kind: "image" as const, source: { kind: "local" as const, file } }
      : { ...base, kind: "file" as const, file };
  });
}

export function chooseAttachments(): Promise<Attachment[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/png,image/jpeg,image/webp,image/gif,*/*";
    input.onchange = () => {
      void saveClipboardFiles(Array.from(input.files || [])).then(resolve, reject);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export function listenForAttachmentDrops(onFiles: (files: File[]) => void) {
  const over = (event: DragEvent) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
    }
  };
  const drop = (event: DragEvent) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) {
      event.preventDefault();
      onFiles(files);
    }
  };
  window.addEventListener("dragover", over);
  window.addEventListener("drop", drop);
  return () => {
    window.removeEventListener("dragover", over);
    window.removeEventListener("drop", drop);
  };
}
