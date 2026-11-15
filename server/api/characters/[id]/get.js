import { fail, json } from "../../http.js";
import { characterView } from "../view.js";

export default function get(req, res, context, id) {
  const row = context.db.prepare("SELECT * FROM characters WHERE id = ?").get(id);
  if (!row) {
    fail(404, "角色不存在");
  }
  return json(res, 200, characterView(row, context));
}
