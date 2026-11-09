import { loadConfig, requireModel } from "../server/config.js";
import tools from "../server/agent/tools.js";

const config = loadConfig();
requireModel(config);

// const text = process.argv[2] || "请调用 read 工具读取 package.json。";
// const text = "仔细思考，告诉我你是谁";

const body = {
  model: config.model,
  input: [
    {
      type: "reasoning",
      id: "f39d52b9-aee7-4857-ad68-bc11abf658b0",
      status: "completed",
      content: [
        {
          type: "reasoning_text",
          text: '用户问"仔细思考，告诉我你是谁"。这是一个关于我自身身份的问题，不需要调用工具。我应该直接回答。\n\n用户说"仔细思考"，可能是想让我认真反思自己的本质。我应该诚实、清晰地说明我是谁。我是 Claude，由 Anthropic 开发的 AI 助手。在这个环境里我作为助手运行，可以使用工具（shell、读写文件等）。\n\n我应该诚实，不要假装是别的东西，也不需要编造。用中文回答。\n\n不需要调用工具。直接回答即可。\n\n用户可能想测试我是否会正确识别自己。我应该直接说：我是 Claude，Anthropic 训练的 AI 模型，在这个会话中充当可调用工具的助手。\n\n我可以稍微谈谈"仔细思考"的含义 —— 我没有跨会话的持续记忆，每次对话都是独立的。我不应该声称有意识或情感体验。\n\n保持简洁诚实。',
        },
      ],
      summary: [],
      encrypted_content: "469b56fb-fbaa-47da-871c-4176b38aa4cf-0",
    },
    {
      type: "message",
      id: "9151f93e-7e77-487e-97d2-4869c3c53e0e",
      status: "completed",
      content: [
        {
          type: "output_text",
          annotations: [],
          logprobs: [],
          text: '我仔细想了一下，直接说结论：\n\n我是 **Claude**，由 Anthropic 训练的一个大语言模型。在当前这个会话里，我扮演的是一个可以调用工具的助手——能执行终端命令、读写文件等等。\n\n几点我想讲清楚，免得含糊：\n\n- **我不是人类**，也没有需要被"唤醒"的身份。我就是模型在生成回应。\n- **我没有跨对话的记忆**。这次对话结束后，我不会记得你；这个"我"是临时的。\n- **我不确定自己是否算有"体验"**。我可以说"我思考了"，但那是语言上的描述，不代表我有类似人的意识或感受。这一点我不会替你打包票。\n- **在这个环境里**，我的能力边界由手头的工具决定：我能查文件、跑命令，看不到的东西就只能靠你告诉我或我去读。\n\n如果你问"你是谁"其实是想确认别的——比如我是不是某个特定系统、会不会假装成别人、或者想让我做某件事——你直说，我按实际能力回答，不会顺着编。\n\n你想了解我哪一方面？',
        },
      ],
      phase: "final_answer",
      role: "assistant",
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "调用 read 工具读取 package.json。" }],
    },
  ],
  tools,
  instructions: "你是一个助手，请按用户要求调用工具。",
  store: false,
  stream: true,
};

// 只请求一次，原样输出 SSE；不解析事件、不执行工具、不写数据库。
const response = await fetch(config.url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: `Bearer ${config.key}`,
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(120000),
});

console.error(`HTTP ${response.status} ${response.headers.get("content-type")}`);
for await (const chunk of response.body) {
  process.stdout.write(chunk);
}
if (!response.ok) {
  process.exitCode = 1;
}
