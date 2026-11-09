# agentic

一个简单的自托管 Agent：浏览器发消息，服务器调用模型，执行四个工具，流式返回事件。

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
    images.js                请求前将本地图片地址转换为 data URL
  agent/
    index.js                 接收消息，执行模型 / 压缩 / 工具循环，向外发事件
    runner.js                接收工具调用，直接导入四个工具并执行、返回结果
    compact.js               生成上下文摘要
    tools.js                 四个工具的定义
    functions/
      shell.js               执行命令
      read.js                读取文本和图片
      write.js               写文件
      edit.js                精确替换
  db.js                      SQLite 连接、DDL、初始化表
  session.js                 Web 与 CLI 共用的会话、上下文、usage 和压缩持久化内核
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

请求顺序例如：`server/index.js → api/index.js → sessions/index.js → [id]/index.js → messages/index.js → post.js`。每层消费一段路径，最后按 HTTP 方法进入处理文件。会话创建、上下文读取、usage 与压缩记录由 `server/session.js` 统一负责，Web API 和 `agent ask` 共用。Agent 依次接收业务方准备的 instructions、messages、model，再接配置等参数，通过 `onEvent` 交付九种运行事件：`message`、`reasoning`、`function_call`、`function_call_output`、`retry`、`usage`、`compact`、`done`、`error`。事件结构与发送顺序见 [dev/agent-events.md](./dev/agent-events.md)。

## 开发

需要 Node.js 22.23.1 或更新版本。

```sh
npm ci
npm ci --prefix ui
npm run ui:build
npm start
```

打开启动日志中的地址，使用日志中的访问令牌登录，在设置里填写模型地址、API Key、协议和模型名。支持 OpenAI Responses 与 Claude Messages；Claude Messages 使用 `x-api-key` 和 `anthropic-version: 2023-06-01`。

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

数据文件是 `chat.db`，DDL 统一放在 `server/db.js`，服务启动时建表：

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  item TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE TABLE compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  through_id INTEGER,
  summary TEXT,
  usage TEXT,
  created_at INTEGER
);
CREATE INDEX idx_messages_session ON messages(session_id, id);
CREATE INDEX idx_compactions_session ON compactions(session_id, id);
```

`item` 是 JSON 字符串，时间是毫秒时间戳。没有 FOREIGN KEY、CHECK 或其他业务表。

- `messages.usage` 保存模型返回的原始 usage JSON，每次响应只放在最后一条模型输出上。用户消息和工具结果为 NULL；模型没有返回 usage 也存 NULL。
- 每次请求模型之前，用上次响应的 `usage.total_tokens` 与 `compact_at` 比较（大于等于时压缩）。用户发消息时从数据库读最近模型输出的 usage；工具执行后继续循环时使用本次模型返回的 usage。不累加历史 usage，不估算 token。
- usage 反映上次响应的实际用量，不包含后来新增的用户输入和工具结果。没有有效用量就跳过判断，不回退到更早的 usage。
- 压缩先发 compact.started，成功后通过 compact.completed 交付标准 user 摘要和数组覆盖范围；先保存摘要与本次压缩 usage，再让 Agent 继续。压缩失败会终止本次运行。最终回答结束后不立即压缩，等下次请求模型前判断。
- 每次压缩追加一条记录，summary 保存标准 user 摘要块的完整文字，`through_id` 表示已总结到哪条消息（包含该条），`usage` 保存压缩请求返回的原始 usage JSON。
- 下一次请求加载**最新摘要 + id 大于 through_id 的消息**。
- 后续压缩包含上次摘要，原始消息始终保留，可以翻看。
- 压缩按完整工具调用边界截断，至少保留 `keep` 条最近消息；没有合适边界或待压缩范围只有一个块就跳过。
- 用户消息立即保存；每轮模型输出和对应工具全部完成后一起保存。失败或取消只丢弃当前未完成轮次，之前完成的工具轮次及已入库摘要保留。已执行的命令和文件修改仍然有效。

开发阶段只使用当前表结构。数据库入口只执行建表，不包含升级、迁移或旧结构处理。

图片保存在数据目录的 `images/` 下。图片工具结果使用标准 `function_call_output.output` 数组，数据库和事件中的 `input_image.image_url` 只保存 `/api/images/文件名`，不保存 Base64。AI 请求入口读取图片文件，仅在本次请求中替换为 data URL；原始消息不变。前端通过带登录鉴权的图片接口显示工具图片。业务层通过运行配置 `images_dir` 指定图片目录。

## 接口

接口使用登录 Cookie 或 `Authorization: Bearer <访问令牌>`。

| 方法                 | 路径                                             | 用途                                 |
| -------------------- | ------------------------------------------------ | ------------------------------------ |
| POST                 | `/api/auth/login`                                | `{ token }` 登录                     |
| POST                 | `/api/auth/logout`                               | 退出                                 |
| GET                  | `/api/auth/me`                                   | 登录状态                             |
| GET                  | `/api/status`                                    | 模型配置状态、版本、工作目录         |
| GET / PUT            | `/api/config`                                    | 查看 / 保存配置                      |
| GET / HEAD           | `/api/images/:name`                              | 查看已保存的图片                     |
| GET / POST           | `/api/sessions`                                  | 列表 / 新建 `{ title? }`             |
| GET / PATCH / DELETE | `/api/sessions/:id`                              | 查看 / 改名 `{ title }` / 删除       |
| GET                  | `/api/sessions/:id/messages?before=123&limit=60` | 历史消息                             |
| POST                 | `/api/sessions/:id/messages`                     | `{ text, images? }` 发消息，返回 SSE |
| POST                 | `/api/sessions/:id/cancel`                       | 停止并等待当前回复清理完成           |
| GET                  | `/api/sessions/:id/compactions`                  | 压缩记录                             |
| GET                  | `/healthz`                                       | 服务存活检查                         |

发送消息的连接使用同一套九种事件，正文和思考分别通过 `message.delta` / `reasoning.delta` 实时显示，完整消息通过对应事件的 `item` 交付。最后一个事件为 `done`，状态是 `completed` / `incomplete` / `aborted`。

每个会话同一时间只处理一条回复；不同会话可以同时执行。关闭页面、切换会话或点击停止，会取消当前连接的执行。刷新后加载已保存的历史。

回复过程中，SSE 同时交付消息的数据库 ID、压缩记录和会话信息，前端直接更新当前状态，回复结束后不再重新拉取消息或会话列表。点击停止会保留 SSE 连接，等服务端确认保存结果后结束。

输入框支持选择或粘贴图片，发送前可预览和移除，也可只发送图片。每条消息最多 5 张，支持 PNG、JPEG、GIF、WebP，单张不超过 10 MiB。图片存放在数据目录 images/，消息只保存本地图片地址；模型请求时读取文件，构造标准 input_image。删除会话时一并删除图片。

## 服务器一行安装

**先将此版本发布到仓库的 Releases**，下面的命令才会安装这次重构的版本：

```sh
curl -fsSL https://raw.githubusercontent.com/yanglongyun/AGENT/main/install.sh | sh
```

Linux 有 systemd 时，安装脚本会启动服务并设置开机启动。发布包包含 Node.js、后端代码和构建后的 UI，服务器无需安装 npm 或编译前端。

```sh
agent ask "检查当前项目"      # 在终端直接向 Agent 提问
agent ask --workdir /path/to/project "跑测试并修复失败"
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

数据默认放在 Linux `~/.config/agentic`、macOS `~/Library/Application Support/agentic`、Windows `%APPDATA%/agentic`。可用 `AGENT_HOME` 指定目录。该目录包含 `config.json`、`chat.db` 及 SQLite 日志文件。

### 验证代码

```sh
npm run check
npm test
npm run ui:test
npm run ui:build
npm run format:check
```

配置文件只接受当前字段，缺失、未知或无效字段会直接报错。模型上下文窗口非零时，压缩阈值必须小于窗口；实际压缩只使用模型返回的 total_tokens。整轮回复超时由 run_timeout 控制，AI 请求不另设隐藏时限。

### 页面路由

前端使用 React Router，页面入口定义在 `ui/src/router.tsx`。

| URL             | 页面     |
| --------------- | -------- |
| `/`             | 新对话   |
| `/sessions/:id` | 指定会话 |
| `/settings`     | 设置     |
| `/login`        | 登录     |

URL 决定当前页面和会话。支持直接打开、刷新、前进后退；新会话创建后用会话 URL 替换新对话入口。未登录时先进入登录页，登录成功后回到原页面。服务器只为这些页面路径返回 `ui/dist/index.html`，未知资源和 API 保持各自的错误响应。
