import { fail, json } from "../../../http.js";
import { summarizeUsage } from "../../../../metering/index.js";

export default function get(req, res, context, id) {
  const db = context.db;
  if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }
  const rows = db
    .prepare(
      `
    SELECT metering.measurement, COALESCE(messages.usage, compactions.usage) AS usage
    FROM metering
    LEFT JOIN messages ON messages.id = metering.message_id
    LEFT JOIN compactions ON compactions.id = metering.compaction_id
    WHERE metering.session_id = ? OR metering.task_id IN (SELECT id FROM tasks WHERE session_id = ?)
  `,
    )
    .all(id, id);
  return json(
    res,
    200,
    summarizeUsage(
      rows.map((row) => ({
        usage: row.usage ? JSON.parse(row.usage) : null,
        measurement: JSON.parse(row.measurement),
      })),
    ),
  );
}
