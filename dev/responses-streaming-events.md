# OpenAI Responses API 流式事件完整清单

核对日期：2026-09-16。

范围：OpenAI 官方 **Responses API HTTP SSE** 流式事件参考页，当前共 **59 种**。下面逐项列出并链接官方定义。模型、工具和请求选项决定实际出现哪些事件；一次请求不会发出全部事件。不包括 Realtime API、Chat Completions、仅用于 WebSocket 的客户端事件或 SDK 自行合成的辅助事件。

依据：[官方事件参考](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[官方流式指南](https://developers.openai.com/api/docs/guides/streaming-responses)。

## 先理解三个层级

```text
response                 一次模型响应
  output[]               输出项：消息、推理项、工具调用等
    content[]            某个输出项里的内容部分（适用于有 content 的项）
```

- `response.output_text.delta`：一个文字部分的一小段增量。
- `response.output_text.done`：这个文字部分结束，不是整次响应结束。
- `response.output_item.done`：这个输出项结束，也不是整次响应结束。
- `response.completed`：整次响应成功完成；读取 `event.response.output`。
- 工具的 `completed` 只代表对应工具调用完成，不等于整个 response 完成。
- `response.failed`、`response.incomplete` 和流内 `error` 要单独处理，不能当作成功完成。

响应完成也不等于用户任务完成：最终 output 可能仍要求调用工具，需要提交工具结果并发起下一次请求。

## SSE 长什么样

请求 `POST /v1/responses`，设置 `stream: true`。下面是本文构造的最小示意事件：

```text
event: response.output_text.delta
data: {"type":"response.output_text.delta","sequence_number":4,"item_id":"msg_demo","output_index":0,"content_index":0,"delta":"你好","logprobs":[]}

```

用 JSON 的 `type` 判断事件类型。一条 SSE 事件以空行分隔；网络读取的一块字节不一定对应一条完整事件。不要把一次 `reader.read()` 的结果直接当作一个 JSON。项目中的 [sse.js](./sse.js) 只是原样打印字节，方便查看完整返回。

## 常见字段

这些字段并非每种事件都有。各表省略共同的 `type` 和 `sequence_number`，列出官方 schema 中其余顶层字段；“可选”表示 optional。嵌套对象的完整定义见事件链接。

| 字段              | 意义                                                      |
| ----------------- | --------------------------------------------------------- |
| `type`            | 事件类型，就是下表中的完整事件名                          |
| `sequence_number` | 流内事件序号                                              |
| `response`        | 响应对象；生命周期事件会携带                              |
| `output_index`    | 对应输出项在 output 数组中的位置                          |
| `item_id`         | 输出项 ID，不要与函数调用的 call_id 混淆                  |
| `content_index`   | 内容部分的位置                                            |
| `summary_index`   | 推理摘要部分的位置                                        |
| `command_index`   | shell 命令的位置                                          |
| `delta`           | 增量；多数为字符串，shell 输出增量为 stdout / stderr 对象 |
| `item` / `part`   | 输出项对象 / 内容部分对象                                 |
| `obfuscation`     | 填充字段，不是业务内容                                    |

## 全部事件

### 响应生命周期与错误（7 种）

| 序号 | 事件                                                                                                                          | 发生时机 / 含义                                              | 除 type、sequence_number 外的顶层字段 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| 1    | [response.created](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.created)         | 创建了响应。                                                 | `response`                            |
| 2    | [response.in_progress](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.in_progress) | 响应正在生成。                                               | `response`                            |
| 3    | [response.completed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.completed)     | 本次响应成功完成；response 中包含最终 output 和用量等信息。  | `response`                            |
| 4    | [response.failed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.failed)           | 本次响应失败；检查 response.error。                          | `response`                            |
| 5    | [response.incomplete](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.incomplete)   | 本次响应结束但未完整生成；检查 response.incomplete_details。 | `response`                            |
| 6    | [response.queued](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.queued)           | 响应进入队列，等待处理。                                     | `response`                            |
| 7    | [error](https://developers.openai.com/api/reference/resources/responses/streaming-events#error)                               | 流中发生错误；查看 code、message 和 param。                  | `code`、`message`、`param`            |

### 输出项和内容部分（4 种）

| 序号 | 事件                                                                                                                                        | 发生时机 / 含义                           | 除 type、sequence_number 外的顶层字段              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| 8    | [response.output_item.added](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.output_item.added)   | output 数组新增一项，此时可能尚未完整。   | `item`、`output_index`                             |
| 9    | [response.output_item.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.output_item.done)     | 某个输出项结束，item 是该项最终形态。     | `item`、`output_index`                             |
| 10   | [response.content_part.added](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.content_part.added) | 某个输出项新增一个内容部分。              | `content_index`、`item_id`、`output_index`、`part` |
| 11   | [response.content_part.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.content_part.done)   | 某个内容部分结束，part 是该部分最终内容。 | `content_index`、`item_id`、`output_index`、`part` |

### 回答文字、注解与拒绝（5 种）

| 序号 | 事件                                                                                                                                                            | 发生时机 / 含义                         | 除 type、sequence_number 外的顶层字段                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| 12   | [response.output_text.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.output_text.delta)                       | 回答文字新增片段。                      | `content_index`、`delta`、`item_id`、`logprobs`、`output_index`              |
| 13   | [response.output_text.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.output_text.done)                         | 一个回答文字部分结束，text 是完整文字。 | `content_index`、`item_id`、`logprobs`、`output_index`、`text`               |
| 14   | [response.refusal.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.refusal.delta)                               | 拒绝文字新增片段。                      | `content_index`、`delta`、`item_id`、`output_index`                          |
| 15   | [response.refusal.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.refusal.done)                                 | 拒绝文字结束，refusal 是完整内容。      | `content_index`、`item_id`、`output_index`、`refusal`                        |
| 16   | [response.output_text.annotation.added](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.output_text.annotation.added) | 文字新增引用或其他注解。                | `annotation`、`annotation_index`、`content_index`、`item_id`、`output_index` |

### 函数调用与 custom 工具输入（4 种）

| 序号 | 事件                                                                                                                                                              | 发生时机 / 含义                                      | 除 type、sequence_number 外的顶层字段  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| 17   | [response.function_call_arguments.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.function_call_arguments.delta) | 函数调用的 JSON 参数字符串新增片段。                 | `delta`、`item_id`、`output_index`     |
| 18   | [response.function_call_arguments.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.function_call_arguments.done)   | 函数调用参数生成结束，arguments 是完整 JSON 字符串。 | `arguments`、`item_id`、`output_index` |
| 19   | [response.custom_tool_call_input.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.custom_tool_call_input.delta)   | 自由格式 custom 工具输入新增片段。                   | `delta`、`item_id`、`output_index`     |
| 20   | [response.custom_tool_call_input.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.custom_tool_call_input.done)     | custom 工具输入结束，input 是完整输入。              | `input`、`item_id`、`output_index`     |

`function_call_arguments` 对应 function 工具的 JSON 参数；`custom_tool_call_input` 对应 custom 工具的自由格式输入。参数 delta 可能是半截 JSON，应等待完整参数后再解析。函数名和 call_id 从对应输出项读取。

### 推理与推理摘要（6 种）

| 序号 | 事件                                                                                                                                                            | 发生时机 / 含义                                          | 除 type、sequence_number 外的顶层字段                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| 21   | [response.reasoning_summary_part.added](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.reasoning_summary_part.added) | 推理摘要新增一个部分。                                   | `item_id`、`output_index`、`part`、`summary_index`                   |
| 22   | [response.reasoning_summary_part.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.reasoning_summary_part.done)   | 某个推理摘要部分结束，可带 status: incomplete。          | `item_id`、`output_index`、`part`、`summary_index`、`status`（可选） |
| 23   | [response.reasoning_summary_text.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.reasoning_summary_text.delta) | 推理摘要文字新增片段。                                   | `delta`、`item_id`、`output_index`、`summary_index`                  |
| 24   | [response.reasoning_summary_text.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.reasoning_summary_text.done)   | 某个推理摘要文字部分结束。                               | `item_id`、`output_index`、`summary_index`、`text`                   |
| 25   | [response.reasoning_text.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.reasoning_text.delta)                 | 推理文字新增片段；事件存在不代表所有模型都提供原始推理。 | `content_index`、`delta`、`item_id`、`output_index`                  |
| 26   | [response.reasoning_text.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.reasoning_text.done)                   | 某个推理文字部分结束。                                   | `content_index`、`item_id`、`output_index`、`text`                   |

推理摘要、推理文本和加密推理内容不是同一个概念。事件参考列出了 reasoning_text 事件，但不能据此假定每个 OpenAI 模型会返回原始思考文字。官方推理指南说明原始推理不公开，支持的模型可按配置提供摘要；需要回传的 reasoning 输出项应完整保留，包括接口提供的 encrypted_content。参见 [官方推理指南](https://developers.openai.com/api/docs/guides/reasoning)。

### 文件检索（3 种）

| 序号 | 事件                                                                                                                                                            | 发生时机 / 含义    | 除 type、sequence_number 外的顶层字段 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| 27   | [response.file_search_call.in_progress](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.file_search_call.in_progress) | 开始文件检索调用。 | `item_id`、`output_index`             |
| 28   | [response.file_search_call.searching](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.file_search_call.searching)     | 正在检索文件。     | `item_id`、`output_index`             |
| 29   | [response.file_search_call.completed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.file_search_call.completed)     | 文件检索调用完成。 | `item_id`、`output_index`             |

### 网页搜索（3 种）

| 序号 | 事件                                                                                                                                                          | 发生时机 / 含义    | 除 type、sequence_number 外的顶层字段 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| 30   | [response.web_search_call.in_progress](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.web_search_call.in_progress) | 开始网页搜索调用。 | `item_id`、`output_index`             |
| 31   | [response.web_search_call.searching](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.web_search_call.searching)     | 正在搜索网页。     | `item_id`、`output_index`             |
| 32   | [response.web_search_call.completed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.web_search_call.completed)     | 网页搜索调用完成。 | `item_id`、`output_index`             |

### 代码解释器（5 种）

| 序号 | 事件                                                                                                                                                                        | 发生时机 / 含义                 | 除 type、sequence_number 外的顶层字段 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| 33   | [response.code_interpreter_call.in_progress](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.code_interpreter_call.in_progress)   | 开始代码解释器调用。            | `item_id`、`output_index`             |
| 34   | [response.code_interpreter_call.interpreting](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.code_interpreter_call.interpreting) | 代码解释器正在执行代码。        | `item_id`、`output_index`             |
| 35   | [response.code_interpreter_call.completed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.code_interpreter_call.completed)       | 代码解释器调用完成。            | `item_id`、`output_index`             |
| 36   | [response.code_interpreter_call_code.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.code_interpreter_call_code.delta)     | 待执行代码新增片段。            | `delta`、`item_id`、`output_index`    |
| 37   | [response.code_interpreter_call_code.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.code_interpreter_call_code.done)       | 代码生成结束，code 是完整代码。 | `code`、`item_id`、`output_index`     |

### 图片生成（4 种）

| 序号 | 事件                                                                                                                                                                          | 发生时机 / 含义                            | 除 type、sequence_number 外的顶层字段                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 38   | [response.image_generation_call.completed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.image_generation_call.completed)         | 图片生成调用完成；该事件自身不带图片数据。 | `item_id`、`output_index`                                                                                                                               |
| 39   | [response.image_generation_call.generating](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.image_generation_call.generating)       | 正在生成图片。                             | `item_id`、`output_index`                                                                                                                               |
| 40   | [response.image_generation_call.in_progress](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.image_generation_call.in_progress)     | 开始图片生成调用。                         | `item_id`、`output_index`                                                                                                                               |
| 41   | [response.image_generation_call.partial_image](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.image_generation_call.partial_image) | 返回部分图片的 Base64 内容。               | `item_id`、`output_index`、`partial_image_b64`、`partial_image_index`、`background`（可选）、`output_format`（可选）、`quality`（可选）、`size`（可选） |

partial_image_b64 是部分图片内容，partial_image_index 是序号。图片生成 completed 事件本身没有图片 payload，最终结果应从对应完成的输出项读取。

### MCP 工具（8 种）

| 序号 | 事件                                                                                                                                                        | 发生时机 / 含义         | 除 type、sequence_number 外的顶层字段  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------- |
| 42   | [response.mcp_call_arguments.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_call_arguments.delta)     | MCP 调用参数新增片段。  | `delta`、`item_id`、`output_index`     |
| 43   | [response.mcp_call_arguments.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_call_arguments.done)       | MCP 调用参数生成结束。  | `arguments`、`item_id`、`output_index` |
| 44   | [response.mcp_call.completed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_call.completed)                 | MCP 调用成功结束。      | `item_id`、`output_index`              |
| 45   | [response.mcp_call.failed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_call.failed)                       | MCP 调用失败。          | `item_id`、`output_index`              |
| 46   | [response.mcp_call.in_progress](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_call.in_progress)             | 正在执行 MCP 调用。     | `item_id`、`output_index`              |
| 47   | [response.mcp_list_tools.completed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_list_tools.completed)     | MCP 工具列表获取成功。  | `item_id`、`output_index`              |
| 48   | [response.mcp_list_tools.failed](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_list_tools.failed)           | MCP 工具列表获取失败。  | `item_id`、`output_index`              |
| 49   | [response.mcp_list_tools.in_progress](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.mcp_list_tools.in_progress) | 正在获取 MCP 工具列表。 | `item_id`、`output_index`              |

### 音频与转录（4 种）

| 序号 | 事件                                                                                                                                                | 发生时机 / 含义                           | 除 type、sequence_number 外的顶层字段 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| 50   | [response.audio.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.audio.delta)                       | 新增一段 Base64 编码的音频字节。          | `delta`                               |
| 51   | [response.audio.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.audio.done)                         | 音频输出结束。                            | 无                                    |
| 52   | [response.audio.transcript.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.audio.transcript.delta) | 音频对应的文字转录新增片段。              | `delta`                               |
| 53   | [response.audio.transcript.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.audio.transcript.done)   | 音频转录结束；schema 不含完整 text 字段。 | 无                                    |

### 服务端上下文压缩（1 种）

| 序号 | 事件                                                                                                                                              | 发生时机 / 含义                        | 除 type、sequence_number 外的顶层字段 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------- |
| 54   | [response.compaction.compacting](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.compaction.compacting) | 服务端上下文压缩进度，不包含摘要正文。 | `item_id`、`output_index`             |

该进度事件最多每 30 秒报告一次新采样的摘要进展，短压缩可能完全不发。它不含摘要，也不更新 compaction 输出项；输出项仍由 response.output_item.added/done 表达生命周期，done 携带最终加密内容。这与本项目自行调用模型生成中文摘要的压缩逻辑不同。

### shell 命令与输出（5 种）

| 序号 | 事件                                                                                                                                                                  | 发生时机 / 含义                                       | 除 type、sequence_number 外的顶层字段                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| 55   | [response.shell_call_command.added](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.shell_call_command.added)               | shell 调用新增一条命令。                              | `command`、`command_index`、`output_index`                      |
| 56   | [response.shell_call_command.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.shell_call_command.delta)               | 某条 shell 命令文本新增片段。                         | `command_index`、`delta`、`output_index`、`obfuscation`（可选） |
| 57   | [response.shell_call_command.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.shell_call_command.done)                 | 某条 shell 命令文本生成结束，不表示已经执行成功。     | `command`、`command_index`、`output_index`                      |
| 58   | [response.shell_call_output_content.delta](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.shell_call_output_content.delta) | shell 命令的 stdout / stderr 新增片段。               | `command_index`、`delta`、`item_id`、`output_index`             |
| 59   | [response.shell_call_output_content.done](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.shell_call_output_content.done)   | shell 命令输出结束，output 包含输出及退出或超时结果。 | `command_index`、`item_id`、`output`、`output_index`            |

shell 命令 delta 的可选 obfuscation 是填充内容。shell 输出 delta 是 `{ stdout?, stderr? }`；对应 done 的 output 是数组，包含 stdout、stderr、outcome 及可选 created_by。outcome 可表示退出码或超时。本项目名为 shell 的工具注册为 function，因此当前项目收到的是 function_call 相关事件，不能仅凭工具名套用这里的 shell 事件。

## 常见事件顺序

以下是简化流程，不是所有请求都必须严格匹配的顺序。多个输出项、内容部分或工具会增加或交错事件。

### 一次普通文字响应

```text
response.created
response.in_progress
response.output_item.added
response.content_part.added
response.output_text.delta       多次
response.output_text.done
response.content_part.done
response.output_item.done
response.completed
```

### 一次函数调用响应

```text
response.created
response.in_progress
response.output_item.added       function_call 项
response.function_call_arguments.delta   多次
response.function_call_arguments.done
response.output_item.done
response.completed
```

接着由业务层执行函数，构造 `function_call_output`，与此前 output 一起放进下一次请求的 input。模型若返回 reasoning 项，也一并保留。

## 与当前项目保存消息的关系

本节描述当前项目自己的实现方式，不是官方要求所有客户端都采用的策略。项目对外使用 [九种运行事件](./agent-events.md)。

| 收到的数据                                        | 当前项目处理                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `response.output_text.delta`                      | 转成 message 事件的 delta 展示，不逐片段入库                                 |
| completed 事件的 `event.response.output`          | 每个 item 原样序列化，模型响应和对应工具结果全部处理完后保存到 messages.item |
| completed 事件的 `event.response.usage`           | 保存到该次模型响应最后一条输出对应的 messages.usage                          |
| `response.failed`、`response.incomplete`、`error` | 进入失败处理，不能作为完整成功输出保存                                       |
| 思考或摘要 delta                                  | 转成 reasoning 事件的 delta，完整 reasoning item 在响应成功后交付            |
| 其余中间事件                                      | 不单独交付；最终 output 中包含的对应内容仍随 item 保存                       |
| 用户输入、工具执行结果                            | 业务代码构造 input message / function_call_output 块后保存                   |

下一次用户输入时，从数据库按顺序读 item，JSON.parse 后组成 input；有压缩时使用最新摘要与未被摘要覆盖的消息。同一次工具循环使用内存中的相同块继续。

### 排查 reasoning_text 缺失时看哪里

1. 在原始 SSE 里查看 reasoning 相关事件。
2. 查看 `response.output_item.done` 事件的 `item` 是否带上相应完整内容。
3. 查看最终 `response.completed` 事件的 `response.output` 是否仍保留该内容。
4. 对照数据库 item 和下一次请求 input，定位差异发生在哪一层。

这是排查步骤，不是对之前 400 错误原因的定论。第三方兼容接口是否完整遵守 OpenAI 的事件和输出结构，要以实际返回为准。不能只凭模型名称或一个错误字符串断定原因。

## 容易混淆的地方

- `response.output_text.delta` 是事件类型，`output_text` 是内容块类型，两者不是同一层。
- `reasoning_text` 可作为内容类型出现；事件名是 `response.reasoning_text.delta/done`。
- `function_call_output` 是下一次请求的输入项，不是一个 SSE 事件名。
- 此参考页没有单独列出 `response.cancelled` 事件；不能把 response 的所有 status 值机械拼成事件名。
- `[DONE]` 不是 Responses 的 JSON 事件，本项目不支持该标记，只以标准结束事件判断结果。
- HTTP 400 可能直接返回错误 JSON，而不是 SSE；先检查 HTTP 状态及 Content-Type。
- 表里的 `.done` / `.completed` 不能互相替换，必须按完整 type 匹配。
- 官方将来可能新增事件；本清单的“全部”以本次核对的 59 个参考页条目为边界。

## 官方来源

- [Responses 流式事件参考（本清单的完整性依据）](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Streaming API responses（开启和读取 SSE）](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Reasoning（推理项、摘要与上下文回传）](https://developers.openai.com/api/docs/guides/reasoning)
