import { json, fail } from "../../../http.js";

export function readCompactions(context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }

  const compactions = context.db
    .prepare(
      `SELECT compactions.*, metering.measurement FROM compactions
      LEFT JOIN metering ON metering.compaction_id = compactions.id
      WHERE compactions.session_id = ? ORDER BY compactions.id`,
    )
    .all(id)
    .map(({ measurement, ...row }) => ({
      ...row,
      usage: row.usage ? JSON.parse(row.usage) : null,
      metering: measurement ? JSON.parse(measurement) : null,
    }));
  return compactions;
}

export default async function get(req, res, context, id) {
  return json(res, 200, { compactions: readCompactions(context, id) });
}
