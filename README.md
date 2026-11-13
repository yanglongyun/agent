# agentic

一个简单的自托管 Agent：浏览器发消息，服务器调用模型，执行六个工具，流式返回事件。

## 目录

```text
ui/                          界面源码
  src/
  dist/                      UI 构建产物，由 server 托管
  package.json
  vite.config.ts             打包到 dist
server/
  index.js                   HTTP 入口，托管 ui/dist，/api 分发
  api/
    index.js                 按路径分发
    http.js                  JSON / SSE 读写
    events/                  全局 SSE 订阅
    auth/
      index.js               分发 login / logout / me
      authorize.js           接口鉴权
      login/index.js         登录
      logout/index.js        退出
      me/index.js            登录状态
    sessions/
      index.js               分发 HTTP 方法或进入 [id]
      get.js                 会话列表
      post.js                新建会话
      [id]/
        index.js             分发会话方法和下一级路径
        get.js               会话详情
        patch.js             修改标题
        delete.js            删除会话及其消息、压缩记录
        messages/
          index.js           分发 GET / POST
          get.js             查询历史消息
          post.js            发送消息、接收 Agent 事件、保存消息和压缩记录
        compactions/index.js 查询压缩记录
        cancel/index.js      取消当前回复
    config/
      index.js               分发 GET / PUT
      get.js                 查看配置
      put.js                 保存配置
    status/index.js          服务状态
    images/
      index.js               分发图片地址
      [name]/index.js        分发 GET / HEAD
      [name]/get.js          读取已保存的图片
  ai/
    index.js                 请求模型、解析流、重试
    claude.js                Claude Messages 协议转换、SSE 解析与原生块回传
    chat.js                  Chat Completions 消息、工具、图片和流式转换
    images.js                请求前将本地图片地址转换为 data URL
  agent/
    index.js                 接收消息，执行模型 / 压缩 / 工具循环，向外发事件
    runner.js                接收工具调用，直接导入六个工具并执行、返回结果
    compact.js               生成上下文摘要
    tools.js                 六个工具的定义
    functions/
      shell.js               执行命令
      read.js                读取文本和图片
      write.js               写文件
      edit.js                精确替换
  db.js                      SQLite 连接、DDL、初始化表
  attachments.js            普通附件保存、读取、清理与模型引用
  events.js                 全局有序广播
  replies.js                会话执行状态与未提交片段
  session.js                 Web 与 CLI 共用的会话/任务消息、上下文、usage 和压缩持久化内核
  tasks.js                   异步子 Agent、任务状态与取消管理
  metering/                  原生用量计量、模型价格规则
  images.js                  图片文件保存与读取
  config.js                  配置读写
  defaults.json              默认配置、提示词
  scripts/                   命令行、安装服务、打包、检查
  tests/                     行为测试
  dist/                      发布包（构建生成）
package.json                 开发命令
install.sh / install.ps1      一行安装入口
agent / agent.cmd            启动器
```

请求顺序例如：`server/index.js → api/index.js → sessions/index.js → [id]/index.js → messages/index.js → post.js`。每层消费一段路径，最后按 HTTP 方法进入处理文件。会话创建、上下文读取、usage 与压缩记录由 `server/session.js` 统一负责，Web API 和 `agent ask` 共用。Agent 接收业务方准备的 instructions、messages、model 和 compactModel，再接配置等参数，通过 `onEvent` 交付九种运行事件：`message`、`reasoning`、`function_call`、`function_call_output`、`retry`、`usage`、`compact`、`done`、`error`。事件结构与发送顺序见 [dev/agent-events.md](./dev/agent-events.md)。

## 开发

需要 Node.js 22.23.1 或更新版本。

```sh
npm ci
npm ci --prefix ui
npm run ui:build
npm start
```

打开启动日志中的地址，使用日志中的访问令牌登录，在设置的模型列表里逐个添加名称、协议、接口地址、模型 ID、API Key 和上下文窗口。模型列表不分配用途；在每个对话顶栏的标题下方切换对话模型（默认使用列表第一个模型，上下文压缩自动沿用同一模型）。选择保存在该次用户消息的 `meta.model_id`、`meta.compact_model_id`，已有对话刷新后恢复上次提交的选择，所选模型被移除时回退到默认模型。支持 OpenAI Responses（`responses`）、OpenAI Chat Completions（`chat-completions`）与 Claude Messages（`anthropic-messages`）。接口地址填写完整 URL，不根据协议重写路径。

Chat Completions 使用 `/v1/chat/completions` 和 Bearer 鉴权；流式请求开启 `stream_options.include_usage`，在 `[DONE]` 前读取最终 usage。消息、图片、工具定义、`tool_calls` 和 `tool` 结果转换集中在 `server/ai/chat.js`；工具参数片段收齐后才交付执行，截断或断流不作为成功响应。可选的原生 `reasoning_content` 转为内部 reasoning，仅向同一端点和模型回送。Chat 的工具结果图片在请求适配层转换为后续视觉输入，内部仍只保存工具结果。Claude Messages 使用 `x-api-key` 和 `anthropic-version: 2023-06-01`。

Gemini 也使用显式选择的 Chat Completions 协议及其 OpenAI 接口地址。适配层支持无 index、按原始调用 ID 关联的工具块，以及工具调用以 stop 结束的响应；仍要求有效调用 ID 和完整 JSON 参数。`extra_content` 中的思考签名随原始块保存，只回送给产生它的端点和模型，工具调用 ID、名称或参数改变时不回送该工具签名。

GPT-6 Luna 和 GPT-6 Sol 的 Chat 工具请求按模型要求设置 `reasoning_effort: "none"`。GPT-6 Astra、GPT-6.1 Sol 和 GPT-6.1 Terra 的工具调用需选择 Responses，参见 [OpenAI 模型说明](https://developers.openai.com/api/docs/guides/latest-model)。协议由用户明确选择，不自动切换。

主模型、压缩提示词和摘要前缀均为静态文本，不替换变量。操作系统、架构、主机、用户、工作目录和当前时间在用户消息创建时采集，存入 `messages.meta.environment`；`item` 只保存用户正文和图片。加载模型上下文时从快照生成最后一个 input_text 块，历史读取和工具循环不会重新采集环境信息；正文展示和复制只使用 item，附件卡片来自 meta.attachments。会话预览只取用户的正文或图片标记。Claude thinking 原块仅在端点、模型、系统指令、工具定义及此前消息均未改变时回送；修改配置或压缩历史后，只在当前请求中排除失效原块，已保存消息保持原样。

开发界面：另开终端运行 `npm run ui:dev`，Vite 代理 `/api` 到本机 9500 端口。改后端可用 `npm run dev`。

```sh
npm run format              # 统一格式化源码
npm run format:check        # 检查格式
npm run check
npm test
npm run build               # 构建 UI，打包当前机器的 Node.js
node server/scripts/smoke-install.js
```

## 数据库与压缩

数据文件是 `agent.db`，DDL 统一放在 `server/db.js`，服务启动时建表：

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  total_cost_nanos INTEGER NOT NULL DEFAULT 0,
  unpriced_requests INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  parent_task_id TEXT,
  call_id TEXT,
  task TEXT,
  model TEXT,
  protocol TEXT,
  status TEXT,
  result TEXT,
  error TEXT,
  worker_pid INTEGER,
  total_cost_nanos INTEGER NOT NULL DEFAULT 0,
  unpriced_requests INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  completed_at INTEGER,
  delivered_at INTEGER
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  task_id TEXT,
  item TEXT,
  meta TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE TABLE compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  task_id TEXT,
  through_id INTEGER,
  summary TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE TABLE metering (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  task_id TEXT,
  message_id INTEGER,
  compaction_id INTEGER,
  measurement TEXT,
  created_at INTEGER
);
CREATE INDEX idx_messages_session ON messages(session_id, id);
CREATE INDEX idx_compactions_session ON compactions(session_id, id);
```

`item`、`usage`、`measurement` 是 JSON 字符串，时间是毫秒时间戳。计量记录通过唯一的 message_id 或 compaction_id 对应一次请求，没有 FOREIGN KEY 或 CHECK。

- `messages.usage` 保存模型返回的原始 usage JSON，每次响应只放在最后一条模型输出上。用户消息和工具结果为 NULL；模型没有返回 usage 也存 NULL。
- 每次请求模型之前，用计量模块读取的上次实际 token 数与 `compact_at` 比较（大于等于时压缩）。Responses 和 Chat Completions 使用 `usage.total_tokens`，Claude 使用原生输入、缓存读取、缓存写入和输出之和。用户发消息时从数据库读最近模型输出的 usage 和计量信息；工具执行后继续循环时使用本次模型返回的用量。不累加历史 usage，不估算 token。
- usage 反映上次响应的实际用量，不包含后来新增的用户输入和工具结果。没有有效用量就跳过判断，不回退到更早的 usage。
- `models` 是模型连接的唯一来源，每个条目包含 `id`、`name`、`model`、`protocol`、`url`、`key`、`context_window`。模型用途由每次请求的 `model_id`、`compact_model_id` 明确指定，配置文件不保存全局用途；Web 界面在顶栏选择模型并让压缩沿用对话模型，CLI 和接口仍可分别指定。主请求、压缩和子 Agent 均使用所选条目的独立连接，支持跨厂商。配置接口只返回 `key_set`，保存时空密钥只按同一条目 ID 保留原值，移除条目后，Web 对话自动回退到模型列表第一项（无模型时提示先添加模型）。压缩模型必须能容纳待总结的历史。
- `compact_on_cache_expiry` 开启后，自上次模型响应结束超过 `cache_ttl` 秒，在下一次模型请求前压缩，即使未达 token 阈值。有效期默认 300 秒，仅用于本地过期判断，不改变厂商缓存设置，也不代表接口报告了精确失效时刻；按接口策略调整。新会话没有上次响应时不触发；最近消息与完整工具边界仍受 `keep` 保护。空闲时不后台请求。
- 压缩先发 compact.started，成功后通过 compact.completed 交付标准 user 摘要和数组覆盖范围；先保存摘要与本次压缩 usage，再让 Agent 继续。压缩失败会终止本次运行。最终回答结束后不立即压缩，等下次请求模型前判断。
- 每次压缩追加一条记录，summary 保存标准 user 摘要块的完整文字，`through_id` 表示已总结到哪条消息（包含该条），`usage` 保存压缩请求返回的原始 usage JSON。
- 下一次请求加载**最新摘要 + id 大于 through_id 的消息**。
- 后续压缩包含上次摘要，原始消息始终保留，可以翻看。
- 压缩按完整工具调用边界截断，至少保留 `keep` 条最近消息；没有合适边界或待压缩范围只有一个块就跳过。
- 用户消息立即保存；每轮模型输出和对应工具全部完成后一起保存。失败或取消只丢弃当前未完成轮次，之前完成的工具轮次及已入库摘要保留。已执行的命令和文件修改仍然有效。

开发阶段只使用当前表结构。数据库入口只执行建表，不包含升级、迁移或旧结构处理。

## 用量与预估费用

AI 回答后的操作栏提供复制与「更多」菜单（含「从此处创建分支」、本轮「用量与费用」和「执行过程」）。分支复制截至该回答的对话、工具记录、图片及当时已有的摘要，创建后打开新对话，标题为「原标题（2）」，同名时递增编号。图片独立保存，删除原对话不会影响分支；历史环境快照保持原样。继承内容不重复计费，分支累计费用从零开始，不复制原对话中的运行任务或命令。接口为 `POST /api/sessions/:id/branches`，请求体 `{ "message_id": 回答消息ID }`。

模型响应的 `usage` 按厂商原样保存，Claude 不补 total_tokens 或改写 input_tokens；Chat 保留 prompt_tokens、completion_tokens 及其原生明细，不改名。`server/metering/index.js` 负责压缩用量和费用计算，`server/metering/rules.js` 维护模型标价；支持 gpt-6-luna、gpt-6.1-terra、gpt-6.1-sol（Responses 和 Chat 共用同一份模型价格）、claude-fable-5-2、claude-sonnet-5-5、claude-opus-5-5。

规则按 USD / 百万 token 计价，价格依据 [OpenAI 官方价格](https://developers.openai.com/api/docs/pricing)和 [Claude 官方价格](https://platform.claude.com/docs/en/about-claude/pricing)，于 2026-11-10 核对。普通输入、输出、缓存读取和不同 TTL 的缓存写入分别收费，GPT 输入超过 272000 token 时使用长上下文价格，推理 token 不重复收费。网关请求按公开标价预估，不代表网关实际扣费。未知模型、未知计费档位或不完整用量不会显示为零费用。

计量表保存当次模型、端点、原始用量对应的上下文计数以及价格明细快照；修改规则不会重算历史费用。主对话流保持纯聊天呈现，不内联工具调用与 Token 计数；每条回答的「更多」菜单可打开该轮的用量与费用弹窗（汇总多次请求及原始 usage JSON），摘要弹窗展示压缩详情与用量。Web 与 CLI 共用保存逻辑，消息、usage 和计量快照在同一事务提交。

sessions 和 tasks 的 total_cost_nanos 以十亿分之一美元累计已记录费用，request_count 和 unpriced_requests 保存计量请求数及未计费数；新增明细与累计字段的原子更新在同一事务提交。任务金额只包含自身请求和自身压缩；会话金额包含主对话、全部子任务及各自压缩，不重复累计父子任务。对话累计总额收进顶栏右上角「更多 → 对话详情与用量」弹窗；分页、刷新和重新打开读取累计快照，不从当前加载的消息重算。尚未计费的请求单独显示，不作为零费用处理。

图片保存在数据目录的 `images/` 下。图片工具结果使用标准 `function_call_output.output` 数组，数据库和事件中的 `input_image.image_url` 只保存 `/api/images/文件名`，不保存 Base64。AI 请求入口读取图片文件，仅在本次请求中替换为 data URL；原始消息不变。前端通过带登录鉴权的图片接口显示工具图片。业务层通过运行配置 `images_dir` 指定图片目录。

## 接口

接口使用登录 Cookie 或 `Authorization: Bearer <访问令牌>`。

| 方法                 | 路径                                             | 用途                                                                                |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| POST                 | `/api/auth/login`                                | `{ token }` 登录                                                                    |
| POST                 | `/api/auth/logout`                               | 退出                                                                                |
| GET                  | `/api/auth/me`                                   | 登录状态                                                                            |
| GET                  | `/api/status`                                    | 模型配置状态、版本、工作目录                                                        |
| GET / PUT            | `/api/config`                                    | 查看 / 保存配置                                                                     |
| GET / HEAD           | `/api/attachments/:id`                           | 下载已保存的普通附件                                                                |
| GET / HEAD           | `/api/images/:name`                              | 查看已保存的图片                                                                    |
| GET / POST           | `/api/sessions`                                  | 列表 / 新建 `{ title? }`                                                            |
| GET / PATCH / DELETE | `/api/sessions/:id`                              | 查看 / 改名 `{ title }` / 删除                                                      |
| GET                  | `/api/sessions/:id/messages?before=123&limit=60` | 历史消息                                                                            |
| POST                 | `/api/sessions/:id/messages`                     | `{ text, model_id, compact_model_id, images?, attachments? }` 发消息，返回 202 JSON |
| GET                  | `/api/events`                                    | 全局 SSE，复用所有会话的事件                                                        |
| POST                 | `/api/sessions/:id/cancel`                       | 停止并等待当前回复清理完成                                                          |
| GET                  | `/api/sessions/:id/compactions`                  | 压缩记录                                                                            |
| GET                  | `/healthz`                                       | 服务存活检查                                                                        |

每个页面只有一条 `GET /api/events` SSE。发送消息使用普通 POST，输入保存并注册任务后立即返回 `202 { epoch, cursor, run_id, message, session }`。输出由全局流推送：`{ epoch, cursor, session_id, run_id, event }`，其中 event 仍是原有九种 Agent 事件及保存确认。某个回复的 done 不关闭全局连接。新增、改名、分支通过 `{ session }` 更新列表，删除通过 `{ deleted_session_id }` 同步。

每个会话同一时间只处理一条回复；不同会话可以同时执行。回复由服务端会话持有，切换会话、刷新或关闭页面不会取消执行。切回来会恢复已保存历史和未提交的实时片段，并继续接收输出；订阅不会重发模型请求或重复计费。主动点击停止、回复超时或服务关闭才取消任务。侧边栏在后台执行期间显示进行中。

全局 SSE 初始连接与断线重连都先发送 `{ epoch, cursor, snapshot: { sessions } }`。打开或切换对话只请求普通历史接口，其一致快照包含 `epoch`、`cursor`、`run_id`、`messages`、`compactions`、`pending`、`reply_result`、`has_more`、`session`。前端暂存查询期间到达的当前会话事件，安装快照后只应用其游标之后的事件，既不重复显示，也不丢失读取边界上的输出。断线自动重连并恢复当前视图，不额外建立逐会话订阅、不轮询对话列表。已断线时暂停发送新消息，避免误以为请求没有执行而重复提交。

服务端只在内存保留当前未提交轮次和每个会话最后一次终止结果，不保存整轮事件日志。已提交数据从数据库读取，最后一次失败或停止可在本服务进程内重新查看。回复结束和压缩完成都直接处理全局事件，不额外查询历史。停止请求保留全局连接，等待对应会话的 done；执行清理完成后才发布 done，之后可立即开始下一轮。

输入框通过回形针入口选择附件，也支持粘贴和拖入。图片与普通文件合计每条最多 5 个、总计不超过 50 MiB；PNG、JPEG、GIF、WebP 图片单张上限 10 MiB，普通文件单个上限 25 MiB。发送前可预览图片、查看文件名和大小、移除附件；支持只发附件。发送失败保留原附件供重试。图片继续使用 input_image 供模型识别。

普通文件以 `attachments: [{ name, data }]` 提交，data 为 Base64 Data URL。文件原样保存至数据目录 `attachments/<UUID>/<原文件名>`，元数据位于 `messages.meta.attachments`，包括 name、type、size、url、path；标准 item 只保存用户正文与图片，不包含文件内容或路径。模型上下文在该用户消息中追加稳定文件引用，Agent 通过现有 read / shell 读取文本或处理 PDF、Office、压缩包等文件，不依赖模型厂商的原生文件接口，也不自动把整份附件转成提示词。下载接口要求登录并强制作为附件下载。历史消息显示可下载的文件卡片；分支复制独立文件，删除原会话不会影响分支；删除会话一并清理附件。没有新增数据库字段或迁移。

## 服务器一行安装

**先将此版本发布到仓库的 Releases**，下面的命令才会安装这次重构的版本：

```sh
curl -fsSL https://raw.githubusercontent.com/yanglongyun/AGENT/main/install.sh | sh
```

Linux 有 systemd 时，安装脚本会启动服务并设置开机启动。发布包包含 Node.js、后端代码和构建后的 UI，服务器无需安装 npm 或编译前端。

```sh
agent ask --model model-id --compact-model summary-id "检查当前项目"      # 在终端直接向 Agent 提问
agent ask --model model-id --compact-model summary-id --workdir /path/to/project "跑测试并修复失败"
agent token
agent status
agent restart
agent stop
agent start
agent uninstall             # 卸载服务，保留数据
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/yanglongyun/AGENT/main/install.ps1 | iex
agent serve
```

本地生成指定平台发布包：

```sh
npm run ui:build
npm run release:pack -- --platform linux --arch amd64
```

平台支持 `linux / darwin / windows`，架构支持 `amd64 / arm64`。打包器下载并校验固定版本 Node.js，产物位于 `server/dist/`。安装时校验 SHA-256；`AGENT_RELEASE_BASE_URL` 可指定私有发布镜像，`AGENT_NO_SERVICE=1` 可只安装不启动。

数据默认放在 Linux `~/.config/agentic`、macOS `~/Library/Application Support/agentic`、Windows `%APPDATA%/agentic`。可用 `AGENT_HOME` 指定目录。该目录包含 `config.json`、`agent.db` 及 SQLite 日志文件。

### 验证代码

```sh
npm run check
npm test
npm run ui:test
npm run ui:build
npm run format:check
```

配置文件只接受当前字段，缺失、未知或无效字段会直接报错。模型上下文窗口非零时，执行所用压缩阈值不超过该窗口减一；token 阈值按计量模块读取的实际上下文计数判断，缓存过期压缩按配置的有效期判断。整轮回复超时由 run_timeout 控制，AI 请求不另设隐藏时限。

### 页面路由

界面采用类似 Messenger 的气泡聊天布局，使用统一的浅色、深色设计变量与 Lucide 图标。Radix 提供弹窗、菜单、提示和详情浮层的键盘交互、焦点管理及视口避让。顶栏展示头像、对话标题、模型切换、连接/回复状态与右上角「更多」菜单（收纳任务与后台命令、对话详情与用量、重命名及删除）；侧栏支持搜索对话与头像在线状态指示；消息区只呈现聊天气泡与打字状态（工具过程与用量收进每条回答的「更多」菜单），搭配单行胶囊输入区，浏览历史时可回到最新消息；设置按模型、指令、压缩、执行与外观分区，保存操作固定在底部。

输入框与附件预览参考并适配了 [Ruixen UI Claude Chat Input](https://ruixen.com/docs/components/claude-chat-input) 的免费源码，适配组件位于 `ui/src/components/ruixen/ChatInput.tsx`，MIT 许可见 [ui/public/licenses/Ruixen-UI-MIT.md](ui/public/licenses/Ruixen-UI-MIT.md)。项目继续使用 Vite 和现有 CSS 变量，不依赖 Ruixen Pro、Next.js 或 Tailwind。

前端使用 React Router，页面入口定义在 `ui/src/router.tsx`。

| URL             | 页面     |
| --------------- | -------- |
| `/`             | 新对话   |
| `/sessions/:id` | 指定会话 |
| `/settings`     | 设置     |
| `/login`        | 登录     |

URL 决定当前页面和会话。支持直接打开、刷新、前进后退；新会话创建后用会话 URL 替换新对话入口。未登录时先进入登录页，登录成功后回到原页面。服务器只为这些页面路径返回 `ui/dist/index.html`，未知资源和 API 保持各自的错误响应。

## 异步子 Agent

主模型可调用 agent 工具，action 为 models、start、status、wait、cancel。models 只返回可选模型的标识、名称、模型 ID 和协议；start 提交 task、可选 model_id 和 context（none 或 fork），立即返回 task_id；子任务独立执行工具循环，主模型可继续工作。fork 复制已提交的上下文快照，不包含当前尚未完成的工具调用，也不复制历史计费。模型默认沿用当前模型；指定其他模型时，使用该条目自己的接口、密钥、协议和窗口。

完成结果会交回直接父 Agent。显式 wait/status 收取的结果保留在该次工具返回中；尚未收取的结果作为带 meta.task_results 的内部 user 输入提交，再继续请求父模型。界面隐藏内部交接，完整子任务消息留在任务下。每个会话同时最多运行 8 个任务，嵌套最多 3 层。停止会话会停止子任务；每个任务使用 run_timeout，并保存 completed、failed、cancelled 或 interrupted 状态。

用户对话保存在 sessions，子任务保存在 tasks，消息、压缩和计量共用原有表，以 session_id / task_id 区分归属。任务费用独立计量；继承上下文不重复计费。会话中的「子任务」可查看状态和费用，点击任务会在主对话内打开详情弹窗，可查看完整消息、原始 usage、摘要和停止任务；关闭后保留主对话、草稿和滚动位置。

接口：GET /api/tasks?session_id=…，POST /api/tasks（session_id、task、model?、context?），GET /api/tasks/:id，GET /api/tasks/:id/messages，GET /api/tasks/:id/compactions，POST /api/tasks/:id/cancel。消息支持 before、limit 分页；任务列表显示最近 100 项。服务关闭会取消本进程任务，执行进程意外退出的任务在下次读取时标记为 interrupted，不自动重跑。

## 后台命令与输入输出

`shell({ command, workdir?, background: true })` 立即返回 `process_id`。普通 shell 继续同步执行。`stdio({ process_id, action, input?, seconds? })` 支持 read、write、wait、close、cancel；write 原样发送文本，换行须包含在 input 中，close 发送 EOF，wait 默认等待 30 秒、最多 60 秒。标准管道不提供 TTY。输出超过 max_output 时只保留末尾，并返回 truncated。

后台命令跨主对话回复运行，不设自动超时；停止或删除会话、服务退出时清理命令及其子进程。子 Agent 启动的后台命令在该任务结束时清理。每个会话最多同时运行 8 条命令。Web 和 CLI 共用执行器及 shell_jobs 记录；CLI 退出前清理命令。服务意外退出后，历史记录显示已中断，不自动重启命令。

界面从顶栏右上角「更多 → 任务与后台命令」弹窗区分子 Agent 和后台命令（有任务运行中时右上角显示状态绿点）。后台命令弹窗显示命令、工作目录、输出与退出码，可发送输入、结束输入和停止命令。stdio 操作不生成重复条目，后台命令不计模型费用。

接口：GET /api/processes?session_id=…、GET /api/processes/:id、POST /api/processes/:id/stdio（action 为 write、close 或 cancel，write 传 input）。
