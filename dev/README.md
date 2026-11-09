# 查看模型的原始 SSE

项目事件：[Agent 的九种运行事件](./agent-events.md)。

OpenAI 事件对照表：[OpenAI Responses API 流式事件完整清单](./responses-streaming-events.md)。

在项目根目录执行：

```sh
node dev/sse.js
```

读取现有模型配置，发送标准 Responses 请求，附上现有四个工具定义。请求体使用脚本内手动填写的实验消息，方便查看思考内容和工具调用块。脚本只打印返回，不执行工具。

需要修改问题时直接编辑脚本中的 input 数组；当前不读取命令行问题。保存原始返回：

```sh
node dev/sse.js | tee dev/response.log
```

标准输出是未经解析的完整响应体，HTTP 状态和内容类型输出到标准错误。API Key 不会打印。

## 非流式请求

`request.js` 使用相同的模型配置和四个工具定义，设置 `stream: false`，打印完整 JSON（只格式化缩进，不过滤字段）。请求体同样在脚本中手动编辑，不读取命令行问题：

```sh
node dev/request.js
node dev/request.js | tee dev/response-json.log
```

非流式返回的顶层就是 response 对象，直接查看它的 `output` 和 `usage`，没有 `response.completed` 事件包装。HTTP 错误也会打印响应体；脚本不执行返回的工具调用。
