import { body, json, fail } from "../../../http.js";
export default async function post(req, res, context, id) {
  const args = await body(req, ["action", "input"]);
  if (!["write", "close", "cancel"].includes(args.action)) {
    fail(400, "请选择发送输入、关闭输入或停止命令");
  }
  const row = context.db.prepare("SELECT session_id FROM shell_jobs WHERE id = ?").get(id);
  let result;
  try {
    result = await context.tasks.shell.stdio(
      { ...args, process_id: id },
      { sessionId: row.session_id },
    );
  } catch (error) {
    fail(400, error.message);
  }
  return json(res, 200, result);
}
