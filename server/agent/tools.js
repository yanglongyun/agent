// 这里只放工具定义，执行代码在 functions 目录。
const tools = [
  {
    type: "function",
    name: "agent",
    description:
      "异步委派独立子 Agent。start 立即返回 task_id，可继续其他工作；context=fork 继承已保存上下文，none 仅接收任务描述。模型默认与当前 Agent 相同；models 列出已添加的模型，start 可通过 model_id 使用对应模型独立的接口和协议。status 查询、wait 等待结果、cancel 停止任务。完成结果会自动交回当前 Agent，完整过程单独保存。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["models", "start", "status", "wait", "cancel"] },
        task: { type: "string", description: "start 的任务目标、必要背景和交付要求" },
        task_id: { type: "string", description: "status、wait、cancel 的任务 ID" },
        context: {
          type: "string",
          enum: ["none", "fork"],
          description: "默认 none，fork 复制当前已提交上下文",
        },
        model_id: {
          type: "string",
          description: "已添加模型的配置标识，先调用 models 查看；省略则沿用父 Agent 模型",
        },
        compact_model_id: {
          type: "string",
          description: "可选压缩模型配置标识，省略时沿用当前对话选择",
        },
        seconds: { type: "integer", description: "wait 的等待秒数，默认 30，最多 60" },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "shell",
    description:
      "执行终端命令并返回合并输出与退出码。显式设置 background:true 启动可跨回复运行的后台命令，立即返回 process_id，使用 stdio 读取、输入、等待或停止。后台命令不设执行超时，在停止会话、删除会话或服务退出时终止；子 Agent 启动的命令在该任务结束时终止。直接运行命令，不使用 nohup、& 或其他脱管方式。支持标准管道，不提供交互终端。",
    parameters: {
      type: "object",
      properties: {
        background: { type: "boolean", description: "默认 false；true 将命令放入后台任务托盘" },
        command: {
          type: "string",
          description: "终端命令",
        },
        workdir: {
          type: "string",
          description: "可选工作目录",
        },
      },
      required: ["command"],
    },
  },
  {
    type: "function",
    name: "stdio",
    description:
      "管理 shell 后台命令的标准输入输出。read 读取保留的合并输出，write 原样写入 input（需要换行时显式传入），wait 等待结束，close 关闭标准输入发送 EOF，cancel 终止整个进程组。输出过长时保留末尾并标记 truncated。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "wait", "close", "cancel"] },
        process_id: { type: "string", description: "shell background 返回的 process_id" },
        input: { type: "string", description: "write 写入的原始文本" },
        seconds: { type: "integer", description: "wait 的等待秒数，默认 30，范围 0 到 60" },
      },
      required: ["action", "process_id"],
    },
  },
  {
    type: "function",
    name: "read",
    description: "读取带行号文本或图片。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        offset: {
          type: "integer",
          description: "起始行，默认 1",
        },
        limit: {
          type: "integer",
          description: "最多行数，默认 2000",
        },
      },
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "write",
    description: "完整写入文件，自动创建父目录。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        content: {
          type: "string",
          description: "完整内容",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    type: "function",
    name: "edit",
    description: "精确替换文本，默认要求唯一匹配。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件路径",
        },
        old_string: {
          type: "string",
          description: "原文",
        },
        new_string: {
          type: "string",
          description: "新内容",
        },
        replace_all: {
          type: "boolean",
          description: "替换全部",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
];

export default tools;
