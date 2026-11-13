import { json, fail } from "../../../http.js";
import { withCost } from "../../../../metering/index.js";
import { messagePreview } from "../../../../session.js";
import { readCompactions } from "../compactions/get.js";

export function readMessages(context, id, limit = 60, before = 0) {
  const session = context.db
    .prepare(
      `SELECT sessions.*, (
    SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1
  ) AS first, (SELECT meta FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1) AS first_meta FROM sessions WHERE id = ?`,
    )
    .get(id);
  if (!session) {
    fail(404, "会话不存在");
  }
  const rows = context.db
    .prepare(
      `
    SELECT messages.*, metering.measurement FROM messages
    LEFT JOIN metering ON metering.message_id = messages.id
    WHERE messages.session_id = ? AND (? = 0 OR messages.id < ?)
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
  const { first, first_meta, ...stored } = session;
  const reply = context.replies.get(id);
  return {
    epoch: context.events.epoch,
    cursor: context.events.cursor,
    run_id: reply?.id || null,
    pending:
      reply?.error && !reply.terminal ? [...reply.pending, reply.error] : reply?.pending || [],
    compactions: readCompactions(context, id),
    messages,
    has_more: rows.length > limit,
    reply_result: reply?.terminal
      ? {
          status: reply.terminal.status,
          stopReason: reply.terminal.stopReason,
          error: reply.error?.error || "",
        }
      : null,
    session: {
      ...withCost(stored),
      preview: first ? messagePreview(JSON.parse(first), JSON.parse(first_meta || "null")) : "",
      running: Boolean(context.replies.get(id)?.running),
    },
  };
}

export default async function get(req, res, context, id) {
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
  return json(res, 200, readMessages(context, id, limit, before));
}
