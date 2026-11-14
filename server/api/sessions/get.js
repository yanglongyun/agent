import { json } from "../http.js";
import { messagePreview } from "../../session.js";
import { withCost } from "../../metering/index.js";

export function readSessions(context) {
  const rows = context.db
    .prepare(
      `
    SELECT sessions.*,
      (
        SELECT item FROM messages
        WHERE session_id = sessions.id
        ORDER BY id LIMIT 1
      ) AS first,
      (SELECT meta FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1) AS first_meta
    FROM sessions
    ORDER BY (sessions.pinned IS NULL) ASC, sessions.pinned ASC, sessions.updated_at DESC
  `,
    )
    .all();

  const sessions = rows.map(({ first, first_meta, ...session }) => {
    const preview = first
      ? messagePreview(JSON.parse(first), JSON.parse(first_meta || "null"))
      : "";
    return {
      ...withCost(session),
      preview,
      running: Boolean(context.replies.get(session.id)?.running),
    };
  });
  return sessions;
}

export default function get(req, res, context) {
  return json(res, 200, { sessions: readSessions(context) });
}
