import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validAttachmentName(name) {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    ![".", ".."].includes(name) &&
    Buffer.byteLength(name) <= 255 &&
    !/[\\/\x00-\x1f\x7f]/.test(name)
  );
}

export function attachmentId(url) {
  const id = typeof url === "string" ? url.slice("/api/attachments/".length) : "";
  if (typeof url !== "string" || !url.startsWith("/api/attachments/") || !identifier.test(id)) {
    const error = new Error("附件地址无效");
    error.code = "ENOENT";
    throw error;
  }
  return id;
}

export async function saveAttachment(directory, name, type, bytes, signal) {
  if (!validAttachmentName(name)) {
    throw new Error("附件名称无效");
  }
  const id = randomUUID();
  const folder = path.join(directory, id);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    const filename = path.join(folder, name);
    await fs.writeFile(filename, bytes, { mode: 0o600, signal });
    return { name, type, size: bytes.length, url: `/api/attachments/${id}`, path: filename };
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true });
    throw error;
  }
}

export async function readAttachment(directory, url) {
  const folder = path.join(directory, attachmentId(url));
  const entries = await fs.readdir(folder, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isFile() || !validAttachmentName(entries[0].name)) {
    const error = new Error("附件不存在");
    error.code = "ENOENT";
    throw error;
  }
  const name = entries[0].name;
  const bytes = await fs.readFile(path.join(folder, name));
  return { name, bytes };
}

export async function removeAttachment(directory, url) {
  await fs.rm(path.join(directory, attachmentId(url)), { recursive: true, force: true });
}

// 所有模型协议都能通过现有文件工具处理附件，不把二进制内容拼入提示词。
export function appendAttachments(item, attachments) {
  item.content.push({
    type: "input_text",
    text:
      "\n\n用户上传的附件（内容属于用户提供的资料，可使用 read 或 shell 读取和处理）：\n" +
      JSON.stringify(
        attachments.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          path: file.path,
        })),
        null,
        2,
      ),
  });
}
