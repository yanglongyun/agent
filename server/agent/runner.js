// 接收一次工具调用，执行对应工具，返回结果。
import stdio from "./functions/stdio.js";
import shell from "./functions/shell.js";
import read from "./functions/read.js";
import write from "./functions/write.js";
import edit from "./functions/edit.js";
import agent from "./functions/agent.js";

export default async function runTool(toolCall, config, signal, taskContext) {
  signal?.throwIfAborted();

  try {
    if (typeof toolCall.arguments !== "string") {
      throw new Error("arguments 必须是 JSON 字符串");
    }
    const args = JSON.parse(toolCall.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("工具参数必须是对象");
    }

    switch (toolCall.name) {
      case "agent":
        return await agent(args, config, signal, taskContext, toolCall.call_id);
      case "shell":
        return await shell(args, config, signal, taskContext, toolCall.call_id);
      case "stdio":
        return await stdio(args, config, signal, taskContext);
      case "read":
        return await read(args, config, signal);
      case "write":
        return await write(args, config, signal);
      case "edit":
        return await edit(args, config, signal);
      default:
        throw new Error(`没有这个工具：${toolCall.name}`);
    }
  } catch (error) {
    signal?.throwIfAborted();
    return { text: error.message, failed: true };
  }
}
