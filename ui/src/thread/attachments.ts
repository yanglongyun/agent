export interface UploadAttachment {
  name: string;
  type: string;
  size: number;
  data: string;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  url: string;
  path: string;
}

export function isImageAttachment(file: { type: string }) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
}

export function attachmentSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KiB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

export function validateAttachments(files: Array<{ size: number; type: string }>) {
  if (files.length > 5) {
    return "每条消息最多发送 5 个附件";
  }
  if (files.some((file) => file.size === 0)) {
    return "附件不能为空";
  }
  if (files.some((file) => isImageAttachment(file) && file.size > 10 * 1024 * 1024)) {
    return "单张图片不能超过 10 MiB";
  }
  if (files.some((file) => file.size > 25 * 1024 * 1024)) {
    return "单个附件不能超过 25 MiB";
  }
  if (files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
    return "每条消息的附件总计不能超过 50 MiB";
  }
  return "";
}
