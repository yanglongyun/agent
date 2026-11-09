import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { body, json, fail } from "../../http.js";

export default async function login(req, res, context) {
  const data = await body(req, ["token"], 4096);
  if (typeof data.token !== "string") {
    fail(401, "访问令牌不正确");
  }
  const provided = Buffer.from(data.token.trim());
  const expected = Buffer.from(context.config.api.token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    fail(401, "访问令牌不正确");
  }
  const key = createHash("sha256")
    .update("agentic-cookie:" + context.config.api.token)
    .digest();
  const expiry = String(Math.floor(Date.now() / 1000) + 2592000);
  const signature = createHmac("sha256", key).update(expiry).digest("hex");
  res.setHeader(
    "set-cookie",
    `agentic_session=${expiry}.${signature}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
  );
  return json(res, 200, { ok: true });
}
