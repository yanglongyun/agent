import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "../http.js";

export default function authorize(req, context) {
  const token = context.config.api.token;
  const provided = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from("Bearer " + token);
  if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
    return;
  }

  const cookie = /(?:^|;\s*)agentic_session=([^;]+)/.exec(req.headers.cookie || "")?.[1] || "";
  const [expiry, signature] = cookie.split(".");
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now() / 1000) {
    fail(401, "请先登录");
  }
  const key = createHash("sha256")
    .update("agentic-cookie:" + token)
    .digest();
  const expectedSignature = Buffer.from(createHmac("sha256", key).update(expiry).digest("hex"));
  const providedSignature = Buffer.from(signature || "");
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    fail(401, "请先登录");
  }

  if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
    let host;
    try {
      host = new URL(req.headers.origin).host;
    } catch {
      fail(403, "跨站请求被拒绝");
    }
    if (host.toLowerCase() !== req.headers.host?.toLowerCase()) {
      fail(403, "跨站请求被拒绝");
    }
  }
}
