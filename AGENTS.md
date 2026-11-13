# 项目代码要求

- 优先让人能直接读懂。使用普通函数、对象、数组和明确的 `if / switch / for`。
- 当前处于开发阶段，禁止任何旧版本、旧字段、旧协议、旧数据结构的兼容或迁移代码，也不保留对应测试、升级脚本和过渡分支。只实现当前确定的结构；开发数据需要重建时直接重建，不为它增加产品代码。
- 固定数据直接写字面量。工具定义直接写数组，不用工厂函数拼装。
- 不给函数动态挂属性，不用立即执行函数隐藏流程，不用隐式类型转换或位运算表达普通数字。
- 条件和循环必须写大括号。每条变量声明只声明一个变量，不写嵌套三元表达式。
- DDL 统一放在 `server/db.js`，启动时初始化。
- 表字段先放标识和业务数据，时间字段放最后；messages 顺序为 id、session_id、task_id、item、meta、usage、created_at。
- API 按 URL 路径逐层拆目录，每层用 `index.js` 分发；同一路径的多个 HTTP 方法分别写在 `get.js`、`post.js` 等文件中。
- Web 与 CLI 共用的会话创建、上下文读取、usage 和压缩保存集中在 `server/session.js`；任务的执行与状态管理集中在 server/tasks.js；共享消息内核使用明确的 owner（sessionId 或 taskId），一条消息只属于其中一个。除此之外，SQL 直接写在对应 API 处理函数内，不建 repository/service 层。
- 注释解释用途和必要的边界处理，变量名表达含义。
- 提交改动前执行 `npm run format`，用 `npm run format:check` 检查格式。
- 修改运行逻辑后执行 `npm run check`、`npm test`；修改界面后执行 `npm run ui:build`。

## Agent 职责

- `server/agent/index.js` 是真正的消息入口和循环体，负责模型请求、压缩及事件输出。
- Agent 工具循环不设置轮数上限。
- Agent 直接使用调用方传入的消息数组，不深拷贝或另建消息副本。
- Agent 和 AI 请求入口按 instructions、messages、model 的顺序接收指令、消息和模型，再接配置等参数；系统提示词保持静态，Agent 原样透传，不做变量替换。Web 与 CLI 共用保存入口，将环境快照存入 messages.meta，item 只保存正文和图片。加载模型上下文时根据该快照在用户消息末尾追加环境，界面不显示环境快照；历史快照不重新采集。
- `models` 列表只管理模型连接，不保存全局模型用途。每次请求必须显式提供 model_id 和 compact_model_id，业务层通过 `runConfig` 取得主连接及独立的 `compact_connection` 快照，再向 Agent 显式传入 model、compactModel；子 Agent 通过 model_id 选择条目，省略时沿用父 Agent。模型列表工具只返回标识、名称、模型与协议，任何接口不回显密钥；不回退或切换协议。
- 工具调用只使用标准 call_id，arguments 只接受 JSON 字符串；不得改用 id、生成替代 ID 或接受其他参数格式。
- Agent 和压缩函数直接导入 AI 请求方法，不从调用方传入模型请求函数，不传 hasSummary 状态。
- AI 入口支持 responses、chat-completions、anthropic-messages 三种协议；适配层转换为统一 output，Agent 和存储不分协议。Chat 的工具使用 tool_calls 和 tool_call_id，不接入已废弃的 function_call 格式。
- Gemini 的 Chat 工具流允许无 index 的完整调用块，按返回的原始调用 ID 关联，并允许工具调用以 stop 结束；不为缺失 ID 造值。extra_content 随 native 原块保存，仅在端点、模型和工具调用一致时回送签名。
- Agent 对外只发九种事件：message、reasoning、function_call、function_call_output、retry、usage、compact、done、error。结构与时机见 `dev/agent-events.md`。
- 完整模型块按 output 原顺序交付，然后发 usage，最后执行工具；done 每次运行只发一次。
- `server/agent/runner.js` 只接收工具调用，解析参数，执行工具并返回结果。
- 每次请求模型前，根据上次响应的实际用量判断压缩：计量模块读取 Responses、Chat Completions 的 `usage.total_tokens`，Claude 按原生输入、缓存与输出计数求和。禁止估算或累加历史 usage。用户输入时从数据库读取，工具循环使用上次响应用量。开启缓存过期压缩时，另以上次模型响应结束时间和 cache_ttl 判断；只在下一次请求前触发，不后台压缩。
- `messages.usage` 保存原始 usage JSON，只附在每次模型响应最后一项；`compactions.usage` 保存压缩请求的原始 usage JSON；摘要必须先入库，再继续请求模型。
- `server/metering/` 独立负责用量计算与价格规则，不改写厂商 usage。计量、模型和价格明细快照存入 `metering` 表，与对应消息或摘要在同一事务保存；标准 item 不加计费字段。
- sessions 和 tasks 用 total_cost_nanos 累计十亿分之一美元，request_count、unpriced_requests 记录已保存的计量请求数和未计费数。新增明细与原子累加在同一事务；会话包含主请求、全部子任务和各自压缩，任务只包含自身及自身压缩，不把后代重复计入父任务。分叉不复制计量或累计金额。API 通过 cost 与 request_count 返回累计快照，界面不从分页消息重算会话总额。
- 普通附件作为 {name,data} 随用户消息提交，保存至数据目录 attachments/<UUID>/<原文件名>，messages.meta.attachments 保存 name、type、size、url、path，item 不含附件路径或 Base64。加载上下文时在该用户消息中追加稳定的文件引用，Agent 用 read/shell 处理，各模型协议共用；系统提示词不变。图片仍使用 input_image。图片与文件合计最多 5 个、50 MiB，普通文件单个 25 MiB、图片单张 10 MiB。下载必须鉴权并强制 attachment；分支复制独立文件并更新元数据路径，删除会话清理本身及子任务引用的附件，消息提交失败清理本次临时文件。
- 工具图片直接放在 function_call_output.output 数组中，不另造 user 消息。图片存文件，数据库和事件只存图片地址；AI 请求入口读文件转 Base64，仅用于本次请求，不修改原消息。
- Chat 的 tool 消息仅支持文本；适配层在全部工具结果之后追加包含图片的视觉输入，仅用于本次 HTTP 请求，不改变内部消息、数据库或事件。
- `runner.js` 直接导入 shell、stdio、read、write、edit、agent 六个工具实现，`functions` 目录不设置 `index.js`。

## UI 构建

- 全局颜色、字体、表面和尺寸统一使用 `ui/src/styles/tokens.css` 的变量；图标使用 `ui/src/icons/Icon.tsx` 中的 Lucide 组件，不手绘同类图标。弹窗、菜单、提示与浮层使用 Radix，保持焦点管理、Escape、键盘操作和视口避让；新增页面同时检查浅色、深色与窄屏。
- Ruixen 输入框的适配源码位于 `ui/src/components/ruixen/ChatInput.tsx`，仅负责展示和文件拖放，发送、附件校验和会话状态仍由 Composer 管理。保留源码归属与 `ui/public/licenses/` 中的许可。

- 前端构建产物统一放在 `ui/dist`，由 `server/index.js` 直接托管。
- 发布包保留 `ui/dist` 的路径，不向 server 目录复制静态文件。

- 输入框分别选择本次请求的 model_id 和 compact_model_id，服务端将二者保存至用户消息 meta；新对话不自动选择，草稿选择按对话隔离，刷新后按该会话最新用户消息恢复。模型删除后显式重新选择，不从历史费用推断模型。
- 前端页面由 URL 路由决定：新对话 `/`、会话 `/sessions/:id`、设置 `/settings`、登录 `/login`。不再用 page 状态或本地保存的会话 ID 决定页面。
- 回复结束后不重新查询消息或会话列表，压缩完成后不重新查询摘要。API 通过现有 SSE 事件附带保存确认和会话信息，前端直接更新；确认只在事务提交后发送，不修改标准 item。
- 生成任务归会话，server/replies.js 只管理执行、未提交事件和终止结果；server/events.js 管理全局有序广播。每个页面只通过 GET /api/events 建立一条 SSE；POST /api/sessions/:id/messages 保存输入后立即返回 202 JSON，停止走普通 HTTP。SSE 信封提供 epoch、cursor、session_id、run_id、event，不增加 Agent 事件类型；新增、改名、分支和删除也通过全局流同步。切换页面只读取历史快照，不建立连接。历史接口原子返回消息、摘要、未提交片段、终止结果和游标，前端缓存查询期间到达的事件，只应用快照游标之后的内容。断线重连自动读取全局列表快照并恢复当前视图，不重发模型请求，不轮询对话列表。切换、刷新、关闭或慢读连接均不取消执行；停止、运行超时和服务关闭才取消。
- AI 回答的分支通过 POST /api/sessions/:id/branches 指定 message_id，复制截至该回答的完整历史及当时已有摘要；摘要边界映射到新消息 ID。分支复制图片文件、保留原环境快照，继承记录标记 inherited，不复制 usage、计量、累计金额或运行中的任务。继承记录不作为本分支上次模型响应的用量或过期时间。创建成功后进入新会话，标题追加（2）并避开同名编号。

## 子任务

- 用户会话归 sessions，子 Agent 归 tasks，messages、compactions、metering 共用并以 session_id / task_id 互斥归属。
- agent.models 列出已添加的模型；agent.start 通过 model_id 可选独立连接，立即返回 task_id；status、wait、cancel 使用该 ID。子任务独立执行同一 Agent 循环，可分叉已提交的完整上下文；继承消息不复制 usage 和计量。
- 每个会话最多同时执行 8 个子任务，最多嵌套 3 层。任务使用独立超时与取消控制器，主会话停止或服务关闭时清理任务。
- 未显式收取的子任务结果，以带 meta.task_results 的标准 user 交接输入返回直接父 Agent；交接输入在模型请求前提交，与 tasks.delivered_at 在同一事务更新。界面隐藏交接输入，不改写用户正文，不伪造 call_id 或重复交付工具返回。
- 子任务记录由 /api/tasks 读取，界面在主对话的任务托盘中用弹窗展示详情，保留主对话、草稿和滚动位置；它们不出现在用户会话列表。任务完整消息、摘要、模型与费用独立保存。

## 后台命令

- shell 仅在 background:true 时将命令交给 server/shell.js，立即返回 process_id；stdio 读写该命令的标准管道，不创建独立任务。前后台进程共用 server/shell-process.js。
- shell_jobs 独立保存后台命令、输出末尾、退出码与状态，使用 session_id 归属会话、task_id 标记启动它的子 Agent。它不产生模型计费。
- 后台命令跨主对话回复存活，无自动超时；停止或删除会话、服务关闭时清理整个进程组，子 Agent 的命令在所属任务结束时清理。每个会话最多 8 条活动命令。
- /api/processes 提供列表、详情及 stdio 操作，界面和子 Agent 共用输入框上方任务托盘，详情在主对话内弹窗展示。
