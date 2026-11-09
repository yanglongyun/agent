import authorize from "../authorize.js";
import { json } from "../../http.js";

export default async function me(req, res, context) {
  authorize(req, context);
  return json(res, 200, { ok: true, version: context.version });
}
