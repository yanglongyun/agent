import { loadConfig, requireModel } from "../server/config.js";
import tools from "../server/agent/tools.js";

const config = loadConfig();
requireModel(config);

// const text = process.argv[2] || "请调用 read 工具读取 package.json。";
const text = "仔细思考，告诉我你是谁";

const body = {
  model: config.model,
  input: [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    },
  ],
  tools,
  instructions: "你是一个助手，请按用户要求调用工具。",
  store: false,
  stream: false,
};

// 只请求一次，打印完整返回；不执行工具、不写数据库。
const response = await fetch(config.url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${config.key}`,
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(120000),
});

console.error(`HTTP ${response.status} ${response.headers.get("content-type")}`);
const raw = await response.text();
try {
  console.log(JSON.stringify(JSON.parse(raw), null, 2));
} catch {
  console.log(raw);
}
if (!response.ok) {
  process.exitCode = 1;
}
