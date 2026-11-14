import { json } from "../../http.js";

export default async function logout(req, res) {
  res.setHeader("set-cookie", "agent_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  return json(res, 200, { ok: true });
}
