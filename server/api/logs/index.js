import summary from "./summary/index.js";
import owners from "./owners/index.js";
import records from "./records/index.js";
import { fail } from "../http.js";

// 日志只读：汇总、对话与子任务列表、单个对话或子任务的全部记录。
export default function logs(req, res, parts, context) {
  const rest = parts.slice(1);
  switch (parts[0]) {
    case "summary":
      return summary(req, res, rest, context);
    case "owners":
      return owners(req, res, rest, context);
    case "records":
      return records(req, res, rest, context);
    default:
      fail(404, "接口不存在");
  }
}
