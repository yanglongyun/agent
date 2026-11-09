# Agent 的九种运行事件

这是本项目 `server/agent/index.js` 向调用方发送的事件，不是 OpenAI 的原始 SSE 事件。OpenAI 原始事件清单见 [responses-streaming-events.md](./responses-streaming-events.md)。

Agent 入口依次接收 `instructions`、`messages`、`model`、`config`、`usage`、`signal` 和 `onEvent`。主模型指令由业务方准备，Agent 原样透传。主模型请求和压缩请求都使用独立的 model 参数，不读取 config.model。Agent 和压缩函数直接导入 AI 请求方法；调用方不传模型请求函数或摘要标记。

Agent 通过 `await onEvent(event)` 交付事件。API 负责 SQL 保存，通过 SSE 转发事件，并在事件外层补充保存结果；原始 item 保持不变。正文和思考的增量也等待回调处理。

## 九种事件

| 类型                   | 含义                     | 主要数据                                  | 发送时机                                                                   |
| ---------------------- | ------------------------ | ----------------------------------------- | -------------------------------------------------------------------------- |
| `message`              | 正文消息                 | `{ delta }` 或 `{ item }`                 | 生成时输出文字增量；模型完整有效返回后输出原始 message                     |
| `reasoning`            | 思考消息                 | `{ delta }` 或 `{ item }`                 | 转发接口提供的思考文字或摘要增量；模型完整有效返回后输出原始 reasoning     |
| `function_call`        | 模型工具调用             | `{ item }`                                | 模型完整有效返回后，按 output 顺序交付完整原始 function_call，不发参数碎片 |
| `function_call_output` | 工具执行结果             | `{ item }`                                | 工具执行结束后交付完整标准 function_call_output                            |
| `retry`                | 请求即将重试             | `{ attempt, maxRetries, delayMs, error }` | 等待重试之前发一次；这不是终止性错误                                       |
| `usage`                | 本次主模型请求的实际用量 | `{ usage }`                               | 本次模型完整 output 全部交付后发一次，随后才执行工具；缺少用量时为 null    |
| `compact`              | 开始压缩或交付完整摘要   | `{ status, item?, start?, end?, usage? }` | 找到可压缩范围后发 started；成功后一次性交付 completed                     |
| `done`                 | 整次 Agent 运行结束      | `{ status, stopReason? }`                 | 最后发一次；status 为 completed / incomplete / aborted                     |
| `error`                | 终止性错误               | `{ code, error }`                         | 最终失败时发一次，随后发 done                                              |

每个对象还包含表中对应的 `type`。

## 1. message

增量和完整消息是两次不同的事件，不能重复入库：

```js
{ type: "message", delta: "你好" }

{
  type: "message",
  item: {
    type: "message",
    id: "msg_example",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "你好", annotations: [], logprobs: [] }]
  }
}
```

示例只展示常见字段。真实模型返回的 item 完整保留，包括 id、phase、content 等字段，不从 delta 重建。delta 用于显示，item 用于保存。

工具读取图片只发 `function_call_output`，不另外构造 user 消息。图片和文字一起放在该工具结果的 output 数组中。

HTTP API 还会在开头发送一条 `{ type: "message", item: 用户输入块 }`，确认用户消息已保存。该条由 API 发出；Agent 本身不会重复发送传入的历史消息或用户输入。

用户发送接口 `POST /api/sessions/:id/messages` 接收 `{ text, images }`。images 是可选的 Data URL 数组，最多 5 张，支持 PNG、JPEG、GIF、WebP，单张上限 10 MiB；text 可以为空，但文字和图片不能同时为空。API 先保存图片文件，再把标准 input_image 加入用户消息的 content。数据库和 SSE 中的 image_url 只有 `/api/images/文件名`，没有 Base64。发起模型请求时才读取文件并转为 Data URL，后续从数据库读取历史时使用同一流程。

## 2. reasoning

```js
{ type: "reasoning", delta: "接口提供的思考片段" }

{
  type: "reasoning",
  item: {
    type: "reasoning",
    id: "rs_example",
    summary: [{ type: "summary_text", text: "接口提供的摘要" }],
    encrypted_content: "接口提供的加密内容"
  }
}
```

上例仅示意结构，不是所有接口都会返回这些字段。`response.reasoning_text.delta` 和 `response.reasoning_summary_text.delta` 都映射为 reasoning.delta；完整 item 原样保留，包含实际返回的 content、summary、encrypted_content 等字段。

不根据增量补造 reasoning 对象。接口没有提供思考内容时，也不估算、不生成替代内容。前端在完整 item 到达后替换临时思考文字，避免重复显示。

## 3. function_call

```js
{
  type: "function_call",
  item: {
    type: "function_call",
    call_id: "call_example",
    name: "read",
    arguments: '{"path":"package.json"}'
  }
}
```

等主模型响应完整有效后，先按 output 顺序交付所有模型块，再发送 usage，最后依次执行工具。不会因为收到参数 delta 或 output_item.done 就提前执行。

同一模型响应内的多个工具调用先全部交付，执行结果随后返回。完整工具调用对象不删字段、不重组。

## 4. function_call_output

```js
{
  type: "function_call_output",
  item: {
    type: "function_call_output",
    call_id: "call_example",
    output: JSON.stringify({ success: true, text: "工具返回的完整文本" })
  }
}
```

图片工具结果的 output 为标准内容数组：

```js
{
  type: "function_call_output",
  call_id: "call_example",
  output: [
    { type: "input_text", text: JSON.stringify({ success: true, text: "已读取图片 example.png" }) },
    { type: "input_image", image_url: "/api/images/随机ID.png", detail: "auto" }
  ]
}
```

图片文件保存在数据目录 images/。数据库和事件只保存图片地址，Base64 不入库。AI 请求入口通过运行配置 images_dir 读取文件，将本次请求中的地址替换成 data URL；不修改原消息。前端通过带现有登录鉴权的 `/api/images/:name` 显示图片。

工具文本统一保存为 JSON 字符串 `{ success, text }`。成功时 success 为 true；参数错误、文件错误、shell 非零退出或命令超时时为 false，text 保存实际说明。图片结果中 input_text 也使用同一结构。显示层按 success 判断失败，不从正文猜测。这种情况不一定终止 Agent，因此不发运行级 error。取消、超时或其他无法继续的异常则进入结束流程。

## 5. retry

```js
{
  type: "retry",
  attempt: 1,
  maxRetries: 2,
  delayMs: 2000,
  error: "API HTTP 503：暂时不可用"
}
```

- attempt 从 1 开始，表示即将进行第几次重试。
- maxRetries 不含首次请求。当前沿用原请求逻辑：最多重试 2 次，等待 2 秒、4 秒；这不是 Agent 工具循环轮数限制。
- 取消、不可重试的 HTTP 错误、模型明确失败或 incomplete 不会重试。
- 已输出正文或思考增量后断流，不自动重试，避免前端重复展示。
- 压缩请求重试也使用此事件；它会出现在 compact.started 与 compact.completed / error 之间。
- 重试期间不发 error；最终仍失败才发一次 error 和 done。

## 6. usage

```js
{
  type: "usage",
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
}

{ type: "usage", usage: null }
```

usage 是模型返回的原始用量对象，不挑字段、不估算，也不累加历史请求用量。缺少用量时就是 null，不回退到更早用量。

**usage 只表示这一次模型响应完成，不表示工具执行完成，也不表示整次 Agent 运行完成。** 一次工具循环可能包含多次模型请求，所以可以有多个 usage。

压缩请求的用量放在 compact.completed.usage，不额外发送普通 usage，也不用摘要请求用量代替主会话用量。

## 7. compact

```js
{ type: "compact", status: "started" }

{
  type: "compact",
  status: "completed",
  item: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "以下是历史上下文压缩摘要：\n\n摘要正文" }]
  },
  start: 0,
  end: 12,
  usage: { input_tokens: 200, output_tokens: 50, total_tokens: 250 }
}
```

- start/end 是**替换之前的 messages 数组下标**，范围为 `[start, end)`，不是数据库 ID，也不是 token 数。
- 当前只压缩消息前缀，start 为 0；上面的例子覆盖下标 0～11。
- 如果数组开头已有旧摘要，它也计入覆盖范围。
- API 用相同位置的消息 ID 找到 through_id，保存摘要完整文本。
- Agent 等 completed 回调成功后，才执行 `messages.splice(start, end - start, item)`，再请求主模型。
- 没有可压缩范围，或待压缩部分只有一个块时，跳过，不发 started；不需要调用方提供 hasSummary。
- 压缩过程中不向外发送摘要正文 delta；只交付一次完整标准 user item。
- 压缩请求失败或摘要保存失败：发 error，再发 incomplete done，不继续主模型请求。失败时没有 compact.completed 成功交付。

## 8. done

```js
{ type: "done", status: "completed" }
{ type: "done", status: "incomplete", stopReason: "max_output_tokens" }
{ type: "done", status: "aborted", stopReason: "aborted" }
```

| status     | 含义                                       |
| ---------- | ------------------------------------------ |
| completed  | 模型完整有效返回，且不再要求调用工具       |
| incomplete | 模型未完整返回，或发生终止性错误、超时     |
| aborted    | 调用方主动取消，包括页面连接断开触发的取消 |

done 是整次运行的最后一个事件，只发一次。正常 completed 省略 stopReason。取消通常只发 aborted done，不额外发 error。

Agent 不限制工具循环轮数。现有 API 的整次回复超时配置仍然生效，超时按 incomplete 处理。

## 9. error

```js
{ type: "error", code: "http_400", error: "API HTTP 400：参数不正确" }
{ type: "done", status: "incomplete", stopReason: "http_400" }
```

code 为可识别的错误代码，error 为说明文字。常见代码：

| code                                     | 含义                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| http_400 / http_429 / http_503 等        | 对应上游 HTTP 状态码                                                      |
| model_incomplete                         | 模型响应未完整生成；done.stopReason 可进一步给出 max_output_tokens 等原因 |
| stream_interrupted                       | 流没有拿到完整结束响应                                                    |
| invalid_response                         | 返回状态或 output 无效                                                    |
| model_failed                             | 上游失败事件没有提供更具体代码                                            |
| compact_error / model_error / tool_error | 相应阶段异常没有提供更具体代码                                            |
| timeout                                  | 请求或整次回复超时                                                        |
| api_error                                | API 层异常没有提供更具体代码                                              |

上游或本地异常提供更具体的 code 时可能沿用该代码；这不是封闭枚举。

运行中的错误通过 error + done 交付。`run()` 返回 `{ text, tokens, status, stopReason }`；其中 tokens 是最后一次主模型请求的 total_tokens 或 null。调用方自身的事件回调如果抛错，会终止运行；如果连 error / done 都无法接收，回调异常仍可能使 run 拒绝，不能把传输故障当作已送达。

## 两个顺序例子

普通回复：

```text
message { delta }       多次
message { item }
usage
done                   completed
```

工具循环：

```text
reasoning { delta }     如有
message { delta }       如有
reasoning { item }      如有
message { item }        如有，完整块以实际 output 顺序为准
function_call { item }  可以有多个
usage
function_call_output { item }
compact started         达阈值且有可压缩范围时
compact completed
message { delta }
message { item }
usage
done                   completed
```

## API 保存规则

1. 用户输入先保存，再发 message 确认。
2. delta 只转发，不写 messages。
3. 原始模型完整块先暂存，usage 附到本次最后一条模型输出上。
4. 无工具调用时，在 usage 到达后提交本次模型消息。
5. 有工具调用时，收到所有对应 function_call_output 后，把本次模型消息和工具结果一起提交；不能仅收到 usage 就提交。
6. 图片作为工具结果的一部分一起保存，item 中只有图片地址；图片文件在工具完成前写入。
7. compact.completed 立即保存摘要，再让 Agent 继续。
8. 失败或取消时，不保存当前未完成工具轮次；之前完成的轮次和已保存摘要保留。已执行的文件修改等副作用仍然有效。

前端通过同一套九种事件显示内容、工具、重试、压缩和结束状态。API 不增加事件类型，也不重复发送 Agent 的 done。

## API 的 SSE 保存信息

以下字段由 API 添加，不属于 Agent 的事件参数，也不会写进标准 item：

| 字段                     | 所在事件                                                                    | 用途                                                                                          |
| ------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `sequence`、`created_at` | 完整 message、reasoning、function_call、function_call_output                | sequence 从 0 开始，在本次 POST 内标识消息；created_at 是保存使用的时间                       |
| `saved`                  | 用户消息确认、无工具响应的 usage、有工具响应的最后一个 function_call_output | 事务提交后交付 `[{ sequence, id, usage, created_at }]`，把前端临时记录对应到数据库记录        |
| `session`                | 用户消息确认、每次提交、done                                                | 完整会话列表项：id、title、preview、running、created_at、updated_at；done 的 running 为 false |
| `compaction`             | compact.completed                                                           | 已保存的摘要记录：id、session_id、through_id、summary、created_at                             |

例如，没有工具调用的响应保存后：

```js
{
  type: "usage",
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  saved: [{
    sequence: 1,
    id: 42,
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    created_at: 1789500000000
  }],
  session: {
    id: "session_example",
    title: "",
    preview: "用户的问题",
    running: true,
    created_at: 1789499999000,
    updated_at: 1789500000000
  }
}
```

- 前端先接收完整 item，再处理同一事件上的 saved，保留已有显示 key 和展开状态。
- 只有 COMMIT 成功才发送 saved。收到完整 item 不等于已经保存；工具轮次取消或失败时，前端丢弃未确认的临时记录，保留此前已确认的消息。
- 回复结束和压缩完成后，不再重新查询消息、压缩记录或会话列表。打开会话时读取历史，加载更早消息时分页查询。
- 点击停止时发送 cancel，保留 SSE 连接，等待保存确认和 done。
- 网络断开可能丢失已提交消息的确认。前端显示错误，用户重新打开会话后读取数据库中的实际结果。

## 当前配置与文件生命周期

- `context_window` 非零时，`compact_at` 必须小于它；模型请求前仍只比较上次实际 `usage.total_tokens` 与阈值，不估算。
- 整轮由业务层 `run_timeout` 和取消信号控制，AI 模块不另设隐藏超时；单独调用 AI 时由调用方传入 signal。
- 图片快照在本轮成功提交后归属于会话；取消或失败清理未提交的图片，删除会话清理已保存图片。
- 前端读取 messages 与 compactions，按消息 ID 排列历史、按 call_id 合并工具结果。
