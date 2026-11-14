import { fail, json } from "../../http.js";

export default function get(req, res, context, id) {
  const note = context.db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
  if (!note) {
    fail(404, "笔记不存在");
  }
  return json(res, 200, note);
}
