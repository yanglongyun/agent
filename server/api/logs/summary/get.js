import { json } from "../../http.js";
import { integerParam } from "../query.js";
import { summarizeUsage } from "../../../metering/index.js";

// 全部对话、子任务和压缩的用量与费用汇总。每次模型请求（消息或压缩）在 metering 里恰有一行，
// 原始用量取自对应的消息或压缩记录。since 是毫秒时间戳，只统计此后发生的请求。
export default function get(req, res, context) {
  const params = new URL(req.url, "http://localhost").searchParams;
  const since = integerParam(params, "since", 0);
  const rows = context.db
    .prepare(
      `
    SELECT metering.measurement, metering.task_id, metering.compaction_id,
      COALESCE(messages.usage, compactions.usage) AS usage
    FROM metering
    LEFT JOIN messages ON messages.id = metering.message_id
    LEFT JOIN compactions ON compactions.id = metering.compaction_id
    WHERE metering.created_at >= ?
  `,
    )
    .all(since);

  // 压缩优先于子任务，其余是对话自己的请求。
  const groups = { session: [], task: [], compaction: [] };
  const all = [];
  for (const row of rows) {
    const record = {
      usage: row.usage ? JSON.parse(row.usage) : null,
      measurement: row.measurement ? JSON.parse(row.measurement) : null,
    };
    all.push(record);
    if (row.compaction_id !== null) {
      groups.compaction.push(record);
    } else if (row.task_id !== null) {
      groups.task.push(record);
    } else {
      groups.session.push(record);
    }
  }
  return json(res, 200, {
    since,
    ...summarizeUsage(all),
    sources: {
      session: summarizeUsage(groups.session),
      task: summarizeUsage(groups.task),
      compaction: summarizeUsage(groups.compaction),
    },
  });
}
