import { json } from "../../http.js";
import { choiceParam, integerParam, likePattern, searchParam } from "../query.js";
import { textExpression } from "../text.js";
import { withCost } from "../../../metering/index.js";
import { messagePreview } from "../../../session.js";

// 对话和子任务合在一张列表里。cost 沿用累计口径：对话包含全部子任务，子任务只含自身。
const OWNERS = `
  SELECT 'session' AS kind, s.id AS id, s.title AS title, NULL AS session_id, NULL AS session_title,
    NULL AS model, NULL AS status, s.total_cost_nanos AS total_cost_nanos,
    s.unpriced_requests AS unpriced_requests, s.request_count AS request_count,
    s.created_at AS created_at, s.updated_at AS updated_at,
    (SELECT COUNT(*) FROM messages WHERE messages.session_id = s.id) AS message_count,
    (SELECT item FROM messages WHERE messages.session_id = s.id ORDER BY messages.id LIMIT 1) AS first_item,
    (SELECT meta FROM messages WHERE messages.session_id = s.id ORDER BY messages.id LIMIT 1) AS first_meta
  FROM sessions s
  UNION ALL
  SELECT 'task', t.id, t.task, t.session_id,
    (SELECT sessions.title FROM sessions WHERE sessions.id = t.session_id),
    t.model, t.status, t.total_cost_nanos, t.unpriced_requests, t.request_count,
    t.created_at, t.updated_at,
    (SELECT COUNT(*) FROM messages WHERE messages.task_id = t.id),
    NULL, NULL
  FROM tasks t
`;

/**
 * 读取列表。id 不为空时只取这一个（records 用它读单个对话或子任务）。
 * q 命中标题、ID 或该对话/子任务任意一条记录的正文。
 */
export function readOwners(context, { kind, q, parent, id, limit, before }) {
  const pattern = likePattern(q);
  const rows = context.db
    .prepare(
      `
    SELECT * FROM (${OWNERS}) AS o
    WHERE (? = 'all' OR o.kind = ?)
      AND (? = '' OR o.session_id = ?)
      AND (? = '' OR o.id = ?)
      AND (? = 0 OR o.updated_at < ?)
      AND (? = '' OR o.title LIKE ? ESCAPE '\\' OR o.id LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM messages m
        WHERE ((o.kind = 'session' AND m.session_id = o.id) OR (o.kind = 'task' AND m.task_id = o.id))
          AND ${textExpression("m")} LIKE ? ESCAPE '\\'
      ))
    ORDER BY o.updated_at DESC, o.id DESC
    LIMIT ?
  `,
    )
    .all(
      kind,
      kind,
      parent,
      parent,
      id,
      id,
      before,
      before,
      q,
      pattern,
      pattern,
      pattern,
      limit + 1,
    );
  const owners = rows.slice(0, limit).map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title ?? "",
    preview: row.first_item
      ? messagePreview(JSON.parse(row.first_item), JSON.parse(row.first_meta || "null"))
      : "",
    session_id: row.session_id,
    session_title: row.kind === "task" ? (row.session_title ?? "") : null,
    model: row.model,
    status: row.status,
    cost: withCost({
      total_cost_nanos: row.total_cost_nanos,
      unpriced_requests: row.unpriced_requests,
    }).cost,
    request_count: row.request_count,
    message_count: row.message_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  return { owners, has_more: rows.length > limit };
}

export default function get(req, res, context) {
  const params = new URL(req.url, "http://localhost").searchParams;
  const result = readOwners(context, {
    kind: choiceParam(params, "kind", ["all", "session", "task"], "all"),
    q: searchParam(params),
    parent: params.get("parent") ?? "",
    id: "",
    limit: integerParam(params, "limit", 100, 1, 200),
    before: integerParam(params, "before", 0),
  });
  return json(res, 200, result);
}
