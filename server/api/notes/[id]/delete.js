import { fail, json } from "../../http.js";

export default function remove(req, res, context, id) {
  const deleted = context.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  if (deleted.changes !== 1) {
    fail(404, "笔记不存在");
  }
  return json(res, 200, { deleted: id });
}
