import { json, fail } from "../../http.js";
import { choiceParam, integerParam, likePattern, searchParam } from "../query.js";
import { textExpression } from "../text.js";
import { readOwners } from "../owners/get.js";
import { summarizeUsage } from "../../../metering/index.js";

// 对话和子任务在各表里用不同的归属列；只允许这两个固定值参与 SQL。
const OWNER_COLUMNS = { session: "session_id", task: "task_id" };

// type 过滤的固定 SQL 片段，用户输入只用来选择其中一个。
const TYPE_CLAUSES = {
  all: "1 = 1",
  message: "json_extract(messages.item, '$.type') = 'message'",
  tool: "json_extract(messages.item, '$.type') IN ('function_call', 'function_call_output')",
  reasoning: "json_extract(messages.item, '$.type') = 'reasoning'",
  usage: "messages.usage IS NOT NULL",
};

const parse = (text) => (text ? JSON.parse(text) : null);

export default function get(req, res, context) {
  const params = new URL(req.url, "http://localhost").searchParams;
  const kind = choiceParam(params, "kind", ["session", "task"], "");
  const type = choiceParam(params, "type", [...Object.keys(TYPE_CLAUSES), "summary"], "all");
  const q = searchParam(params);
  const limit = integerParam(params, "limit", 100, 1, 500);
  const before = integerParam(params, "before", 0);
  const id = params.get("id") ?? "";
  if (kind === "") {
    fail(400, "kind 无效");
  }
  if (id === "") {
    fail(400, "id 无效");
  }

  const { owners } = readOwners(context, { kind, q: "", parent: "", id, limit: 1, before: 0 });
  if (owners.length === 0) {
    fail(404, "记录不存在");
  }
  const column = OWNER_COLUMNS[kind];
  const db = context.db;

  // summary 类型只看压缩摘要，不返回消息。
  let records = [];
  let hasMore = false;
  if (type !== "summary") {
    const rows = db
      .prepare(
        `
      SELECT messages.*, metering.measurement FROM messages
      LEFT JOIN metering ON metering.message_id = messages.id
      WHERE messages.${column} = ?
        AND (? = 0 OR messages.id < ?)
        AND ${TYPE_CLAUSES[type]}
        AND (? = '' OR ${textExpression("messages")} LIKE ? ESCAPE '\\')
      ORDER BY messages.id DESC
      LIMIT ?
    `,
      )
      .all(id, before, before, q, likePattern(q), limit + 1);
    hasMore = rows.length > limit;
    records = rows
      .slice(0, limit)
      .reverse()
      .map(({ measurement, ...row }) => ({
        id: row.id,
        session_id: row.session_id,
        task_id: row.task_id,
        item: JSON.parse(row.item),
        meta: parse(row.meta),
        usage: parse(row.usage),
        metering: parse(measurement),
        created_at: row.created_at,
      }));
  }

  // 压缩记录数量很少，不分页，整体返回；关键字只匹配摘要文本。
  let compactions = [];
  if (type === "all" || type === "summary") {
    const needle = q.toLowerCase();
    compactions = db
      .prepare(
        `
      SELECT compactions.*, metering.measurement FROM compactions
      LEFT JOIN metering ON metering.compaction_id = compactions.id
      WHERE compactions.${column} = ?
      ORDER BY compactions.id
    `,
      )
      .all(id)
      .filter((row) => needle === "" || String(row.summary).toLowerCase().includes(needle))
      .map((row) => ({
        id: row.id,
        session_id: row.session_id,
        task_id: row.task_id,
        through_id: row.through_id,
        summary: row.summary,
        usage: parse(row.usage),
        metering: parse(row.measurement),
        created_at: row.created_at,
      }));
  }

  // 终身汇总不受 type、关键字和分页影响。对话只统计自己的请求（含自己的压缩），子任务另算。
  const summary = summarizeUsage(
    db
      .prepare(
        `
      SELECT metering.measurement, COALESCE(messages.usage, compactions.usage) AS usage
      FROM metering
      LEFT JOIN messages ON messages.id = metering.message_id
      LEFT JOIN compactions ON compactions.id = metering.compaction_id
      WHERE metering.${column} = ?
    `,
      )
      .all(id)
      .map((row) => ({ usage: parse(row.usage), measurement: parse(row.measurement) })),
  );

  return json(res, 200, {
    owner: owners[0],
    summary,
    records,
    has_more: hasMore,
    compactions,
  });
}
