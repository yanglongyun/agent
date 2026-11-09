import { json } from "../http.js";

export default async function get(req, res, context) {
  const rows = context.db
    .prepare(
      `
    SELECT sessions.*,
      (
        SELECT item FROM messages
        WHERE session_id = sessions.id
        ORDER BY id LIMIT 1
      ) AS first
    FROM sessions
    ORDER BY updated_at DESC
  `,
    )
    .all();

  const sessions = rows.map(({ first, ...session }) => {
    const content = first ? JSON.parse(first).content : [];
    let preview = content.map((part) => part.text || "").join("");
    preview = preview.replace(/\s+/g, " ").slice(0, 60);
    if (!preview && content.some((part) => part.type === "input_image")) {
      preview = "[图片]";
    }
    return { ...session, preview, running: context.activeReplies.has(session.id) };
  });
  return json(res, 200, { sessions });
}
