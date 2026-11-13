import { readAttachment } from "../../../attachments.js";
import { fail } from "../../http.js";

export default async function get(req, res, context, id) {
  let file;
  try {
    file = await readAttachment(context.paths.attachments, `/api/attachments/${id}`);
  } catch (error) {
    if (error.code === "ENOENT") {
      fail(404, "附件不存在");
    }
    throw error;
  }
  const name = encodeURIComponent(file.name).replace(
    /['()*]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": file.bytes.length,
    "content-disposition": `attachment; filename*=UTF-8''${name}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  });
  res.end(req.method === "HEAD" ? undefined : file.bytes);
}
