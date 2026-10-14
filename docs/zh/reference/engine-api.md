# 引擎 HTTP API（`abx-engine/1`）

引擎是一个本机进程，把提供商这一层只实现一次，让 CLI 和所有 SDK（现在是 Python，之后是 Node、Go、Java）调用同一份提供商代码。它就是运行 `abx provider engine serve` 的 Node.js CLI。SDK 找不到引擎时会自己启动一个，并通过回环地址上的 HTTP、SSE 和 WebSocket 与它通信。这套 API 不需要 gRPC，也不需要代码生成：任何带 HTTP 客户端的语言都能用。

官网：<https://www.agent-sandbox.com>。提供方注册站：<https://registry.agent-sandbox.com>。目录安装拉取 `https://registry.agent-sandbox.cn/providers/index.json`。

## 启动、发现与停止

```bash
abx provider engine serve [--idle-timeout 900] [--port 0]   # 前台运行；SDK 以后台方式启动
abx provider engine status                                   # 没有引擎时退出码为 1
abx provider engine stop
```

运行中的引擎写入 `~/.abx/engine.json`（权限 0600），并持有 `~/.abx/engine.lock`，所以并发启动只会留下一个引擎：

```json
{ "protocol": "abx-engine/1", "pid": 4242, "host": "127.0.0.1", "port": 51234, "token": "…", "version": "0.3.0", "started_at": "2026-10-14T12:00:00Z" }
```

- 引擎只监听 `127.0.0.1`。`Host` 不是回环地址、或带有 `Origin` 头（来自浏览器页面）的请求会被拒绝。
- 每个请求带 `Authorization: Bearer <token>`，WebSocket 升级用同样的头。
- 引擎在 `--idle-timeout` 秒内没有请求就退出（默认 900）。空闲 600 秒的会话会被关闭。客户端遇到连接错误、或重启后收到 401 时，重新读取 `engine.json` 并启动新引擎。
- 日志在 `~/.abx/engine.log`。SDK 启动 `ABX_BIN`（一整条命令行）指定的 CLI，没有就用 `PATH` 里的 `abx`。

## 连接

引擎自己不保存账号。每个请求带上客户端解析好的连接（客户端自己的 config、环境变量和 `.env` 层）：

```json
{ "provider": "e2b", "provider_options": { "base_url": "…" }, "api_key": "…", "api_url": "…", "domain": "…", "access_key_id": "…", "access_key_secret": "…" }
```

放在请求头 `X-Abx-Connection`（JSON 的 base64url，无填充），或者在 `POST` 请求体里用同名字段。会话以“连接指纹 + 沙箱 id”为键，所以两个账号不会共用会话。后端不再认识的会话，会通过 `connect` 重建一次。

## 路由

路径都以 `/v1` 开头。除特别说明外请求体是 JSON。`:id` 是提供商的沙箱 id。

| 方法与路径 | 作用 |
|---|---|
| `GET /health` | `{protocol, version, pid, uptime_s, sessions}` |
| `POST /shutdown` | 停止引擎 |
| `GET /providers` | 已安装的提供商：id、name、version、kind、trust、features、error |
| `POST /sandboxes` | 创建（`template`、`timeout`、`envs`、`metadata`、`cpu`、`memory`、`disk`、`gpu`、`secure` 等）；返回 `201` 和沙箱记录 |
| `GET /sandboxes?status=&limit=&offset=` | 列表：`{sandboxes: […]}` |
| `POST /sandboxes/:id/connect` | 接入已有沙箱 |
| `GET /sandboxes/:id` · `DELETE /sandboxes/:id` | 查看 · 终止 |
| `GET /sandboxes/:id/running` | `{running}` |
| `POST /sandboxes/:id/timeout` | `{timeout}`，单位秒 |
| `POST /sandboxes/:id/pause` · `/resume` | 暂停 · 恢复 |
| `GET /sandboxes/:id/ports/:port/url` | 端口的 `{url, headers}` |
| `POST /sandboxes/:id/commands/run` | 运行到结束：`{stdout, stderr, exit_code}` |
| `POST /sandboxes/:id/commands/stream` | SSE：`stdout`/`stderr`/`exit` 事件，然后 `end`（请求体：`cmd`，或 `cmd` + `args`，以及 `env`、`cwd`、`user`、`timeout`） |
| `GET /sandboxes/:id/processes` | 运行中的进程 |
| `POST /sandboxes/:id/processes/:pid/signal` · `/stdin` · `DELETE …/:pid` | 发信号 · 写标准输入 · 终止 |
| `GET` / `PUT /sandboxes/:id/files/content?path=` | 读写原始字节（`application/octet-stream`） |
| `GET /sandboxes/:id/files/list` · `/info` · `/exists` | 目录列表、stat、是否存在（`path`、`depth`） |
| `POST /sandboxes/:id/files/mkdir` · `/move` · `DELETE …/files` | 建目录 · 重命名 · 删除 |
| `GET /sandboxes/:id/files/watch` | 文件变化的 SSE |
| `POST /sandboxes/:id/code/run` | 运行代码：`code`、`language`、`context_id`、`envs`、`timeout` |
| `…/code/contexts` | 创建、列出、重启、删除代码上下文 |
| `GET /sandboxes/:id/terminal?cols=&rows=&shell=` | WebSocket PTY：二进制帧是双向字节；文本帧 `{"type":"resize","cols":…,"rows":…}` 调整大小 |

提供商没有声明的能力返回 `501`，即 CLI 报告的 `E8004` 同一情形。

## 错误

```json
{ "error": { "type": "SandboxNotFoundError", "code": "E2009", "message": "…", "suggestion": "…", "docs_url": "…" } }
```

`type` 就是 SDK 的异常类名，客户端据此还原同一个异常。状态码：`404` 未找到，`401` 令牌错误或提供商认证失败，`501` 缺少能力，`400` 取值或配置错误，`500` 其他。SSE 流里同一个对象以 `error` 事件到达。

## 引擎承载哪些类型

引擎承载 `builtin`（`alicloud-express`）、`rest`（`e2b-rest/1`）、`exec`（第三方插件的 EPP/1 子进程）和 `node`（进程内的 `node/1` 模块：`opensandbox`、`e2b`、`cubesandbox`、`alicloud-container`）提供商。客户端看不出区别。

`agent_sandbox.engine` 里的 Python gRPC 引擎，对提供商插件而言已被这个引擎取代。
