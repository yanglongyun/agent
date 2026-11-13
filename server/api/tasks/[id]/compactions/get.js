import { json, fail } from "../../../http.js";

export default async function compactions(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM tasks WHERE id = ?").get(id)) {
    fail(404, "任务不存在");
  }

  const compactions = context.db
    .prepare(
      `SELECT compactions.*, metering.measurement FROM compactions
      LEFT JOIN metering ON metering.compaction_id = compactions.id
      WHERE compactions.task_id = ? ORDER BY compactions.id`,
    )
    .all(id)
    .map(({ measurement, ...row }) => ({
      ...row,
      usage: row.usage ? JSON.parse(row.usage) : null,
      metering: measurement ? JSON.parse(measurement) : null,
    }));
  return json(res, 200, { compactions });
}
