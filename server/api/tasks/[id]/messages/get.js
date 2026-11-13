import { json, fail } from "../../../http.js";

export default async function get(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM tasks WHERE id = ?").get(id)) {
    fail(404, "任务不存在");
  }
  const query = new URL(req.url, "http://localhost").searchParams;
  const limitText = query.get("limit") ?? "60";
  const beforeText = query.get("before") ?? "0";
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(Number(limitText))) {
    fail(400, "limit 无效");
  }
  if (!/^\d+$/.test(beforeText) || !Number.isSafeInteger(Number(beforeText))) {
    fail(400, "before 无效");
  }
  const limit = Math.min(500, Math.max(1, Number(limitText)));
  const before = Number(beforeText);
  const rows = context.db
    .prepare(
      `
    SELECT messages.*, metering.measurement FROM messages
    LEFT JOIN metering ON metering.message_id = messages.id
    WHERE messages.task_id = ? AND (? = 0 OR messages.id < ?)
    ORDER BY messages.id DESC LIMIT ?
  `,
    )
    .all(id, before, before, limit + 1);
  const messages = rows
    .slice(0, limit)
    .reverse()
    .map(({ measurement, ...row }) => ({
      ...row,
      item: JSON.parse(row.item),
      meta: row.meta ? JSON.parse(row.meta) : null,
      usage: row.usage ? JSON.parse(row.usage) : null,
      metering: measurement ? JSON.parse(measurement) : null,
    }));
  return json(res, 200, { messages, has_more: rows.length > limit });
}
