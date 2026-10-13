# 2026-10-13 差分分组（相对 Python ebx 0.2.0）

Oracle：Python ebx 0.2.0（本地 venv 的 `bin/ebx`）。对照日志在 `/tmp/diff-fast/`，本文件不改那五份日志。

| 套件 | 日志里的 DIFF | 组1 保留 | 组2 该补 |
|---|---:|---:|---:|
| sandbox_cmds | 73 | 73 | 0 |
| sandbox_subcmds | 28 | 28 | 0 |
| config_cmds | 116 | 3 | 113 |
| template_cmds | 30（另有 2 条 FIXED，已一致，不是 DIFF） | 30 | 0 |
| mcp_toolerr 已展开块 | 175 | 175（见下：12 块的 suggestion 文案按组2已改，错误码仍属组1） | 文案，不另计条目 |
| 合计已展开 | 422 | 309 | 113 |

`mcp_toolerr` 收尾写的是 486 differences / 5256 comparisons。日志只展开 175 块，未展开 311 条。带 `first 6 shown` 的 11 个模式合计 388 条、日志里各 7 块（6 条调用 + 1 条 stub），隐藏 311 条；其余 25 个模式没有截断说明，块数 98，与 `486 - 388` 一致。隐藏条与同一模式里已展开的块是同一类差异，下面按模式归组，没有逐条虚构未打印的调用名。

组2修的是行为，不是把 Node 改回 0.2.0 的旧表面。`--model` 不删。`E2B_API_KEY` / `api_url` / `AccessKey` 不恢复。无效 API key 保持 **E1001**，不改成 E2000。

## E2000 与 E1001

文档和当前 Python 错误码表都把无效 API key 定为 E1001，创建失败的基类才是 E2000：

- `cli/docs/zh/reference/error-codes.md`：E1001 = `InvalidAPIKeyError`；E2000 = `SandboxCreationError`（创建失败基类）。
- `cli/src/models/errors.ts` 与 `python-sdk/client-sdk/src/easy_sandbox/models/errors.py`：`InvalidAPIKeyError.code = "E1001"`，`SandboxCreationError.code = "E2000"`。

旧 ebx 0.2.0 把平台 HTTP 401 印成 `[E2000] Invalid API key`（退出码 1），或直接抛 httpx 原文。这是 KI-006 要修的误分类。Node 报 E1001、退出码 3，与文档一致。条件「文档和 Python 错误码表规定无效 key 是 E2000」不成立，**不把 Node 改回 E2000**。

这些条目因此留在组1。日志里的 suggestion 仍是旧句 `Check your E2B_API_KEY environment variable or pass api_key parameter.`，那一句按组2改掉，错误码不动。

## 1. 合理，保留

Node 多出来的能力，或已经批准、不应为了字节级对齐 0.2.0 而撤回的修正。

### sandbox_cmds（73）

`--model` 与未知选项提示（5）：

- `help create`、`help -h create`、`help sandbox create`、`help create json`：帮助里多了 `--model`。
- `create unknown option`：`Did you mean '--model'?`。

平台 401 → E1001（8，KI-006；suggestion 文案见组2）：

- `create platform 401`（旧版 E2000 / 退出码 1，Node E1001 / 退出码 3）
- `list 401`、`info 401`、`kill 401`、`kill all list 401`、`kill all first 401`、`kill all first 401 json`、`exec platform 401`（旧版 E1000）

文件传输按 envd 错误码（14，KI-005）：旧版笼统 E5000 / E1000 / E2002，Node 为 E4000 / E4001 / E4002。

- `create upload write 500`、`upload write fails midway`、`upload write 500`、`upload write 401`、`upload write 404`
- `download remote 404`、`download remote 500`、`download remote 401`、`download remote relative`、`download remote root`、`download 403`、`download 429`、`download 502 html`、`download invalid id chars`

平台 404 → E2009（7，KI-005）：

- `info 404`、`kill 404`、`exec platform 404`、`connect platform 404`、`upload platform 404`、`download platform 404`、`run platform 404`

自然语言创建（35）：差异是 `--model` / 被拒绝的模型 `qwen3-coder-plus` 提示，和/或 Node 拒绝「`commands.py` 在 import 时调用 `serve()`/`start()`」（E2007）。这是生成结果校验，不是漏掉的旧行为。其中只差模型提示的 11 条：

- `create ai non-tty gate (assessment unavailable)`、`create ai -y generation fails`、`create ai -y generation fails json`
- `tty create ai json (no switch prompt, incomplete)`
- `tty clarify empty answer cancels`、`tty clarify whitespace answer cancels`、`tty clarify eof`、`tty clarify ctrl-c`
- `non-tty incomplete json`、`non-tty incomplete`、`non-tty generation nofiles`

其余 24 条同时有 serve()/start() 拒绝（旧版写成了模板或走到了别的错误，Node 工作区为空）：

- `tty create ai switch yes`、`tty create ai switch yes (research fails)`、`tty create ai switch yes --dir warns`
- `tty create ai switch no, confirm no`、`tty create ai switch enter (default no), confirm eof`、`tty create ai switch invalid then y`
- `tty create ai dir prompt custom`、`tty create ai dir prompt whitespace`、`tty create ai --dir given skips prompt`
- `tty create ai -y skips every prompt`、`tty create ai -y json`
- `tty clarify two questions then template-only`、`tty clarify delegation answer`、`tty clarify repeated question`、`tty clarify no question left`、`tty clarify safety limit`、`tty clarify assessment unavailable midway`、`tty clarify assessment unavailable at start`、`tty clarify percentage scale`、`tty clarify unicode answer`
- `non-tty incomplete -y generates`、`non-tty complete, no -y, gate`、`non-tty research failure hints`、`non-tty generation ok -y deploys (docker unavailable)`

`run` 只把请求体 `envVars` 改成 `envs`（4，KI-001）：

- `run A deploy required via --arg`、`run A deploy via extra args`、`run A deploy injection value`、`run A deploy arg overrides extra`

### sandbox_subcmds（28）

空目录列文件（3，KI-007）：缺失目录不再装成空列表。`files list empty`、`files list empty json`、`files list empty quiet`：旧版退出码 0、stdout「Directory is empty」，Node 退出码 4、E4001，并多一次 `Stat`。

这是批准的修正。**没有写入 SDK-defect allow-list。** 允许名单的匹配要求「退出码 0→4 + 空目录文案 + 多出来的 Stat」。10 月 12 日这份日志是这个形状；当天之后再跑 `sandbox_subcmds.mjs --only "files list empty"` 时，Node 不再读取 `E2B_API_URL`，请求没进 stub，先以 E1001 失败。若把这 3 个 id 写进 `sdk_defect_ids.json`，完整一轮会判 STALE。`E2B_API_URL` 不恢复。`sdk_defect_ids.json` 不新增。

文件 / 进程错误码（KI-002 / KI-004 / KI-005 / KI-006）：

- `files list 404`、`files list 500`、`files list 401`、`files stat 404`、`files mkdir 409`、`files mkdir 404`、`files rm 404`、`files mv 404`、`files stat error --json`：E4000 / E4001，不再用笼统 E5000 / E1000。
- `files stat file`：KI-002，Node 的 Name/Path 为空、Size 为 0（旧版印出 `app.py`）。
- `process list 404`、`process signal 404`、`process signal 500`：E3006。
- `process signal default`、`process signal 9`、`process signal quiet`、`process signal pid 2**53+1`、`global --verbose`：请求体改为 `{"process":{"pid":...},"signal":"SIGNAL_SIGTERM|SIGNAL_SIGKILL"}`。
- `process signal -s 2 json`、`process signal sig 20 digits`、`process signal help`、`process signal -h`：envd 只投递 SIGTERM(15) 与 SIGKILL(9)，帮助文本与拒绝 SIGINT / 超大信号号一致。
- `capabilities 404`、`files list platform 404`：E2009。
- `process list platform 401`：E1001（suggestion 文案见组2）。

### config_cmds 里留下的 3 条

- `warn: corrupt config + version`、`config file created on plain invocation?`：stdout 版本号 0.2.0 对 0.3.0。
- `pty: set secret masked alias api_key`：Node 多一句 `note: 'api_key' is now 'sandbox_api_key' (the old name keeps working).` 旧配置名不恢复成正式键。

### template_cmds（30）

- `help template init`、`help -h template init`、`help top init`：帮助多了 `--model`。
- `list 401`、`info 401`：E5000 / 退出码 1 → E1001 / 退出码 3。suggestion 旧句按组2改。
- `list unreachable`：旧版 E5001（连不上 stub）。Node 的 `loadConfig` 不读 `E2B_API_URL`，打到默认公网地址并印出了模板表（日志里是 `tmpl-001`）。不把 `E2B_API_URL` 加回配置。
- `list official no creds json`：可见输出一致；Node 多了 `GET /templates`，`Authorization: Bearer stub-key`。这是官方 API 路径上的鉴权，不据此恢复旧环境变量名。
- `top deploy verbose`：流水线日志一致。ListTeams 失败句在归一化之后少了单独的 Suggestion 行；`getTeamId` 仍设置了 AK/SK 提示。记为 SDK 错误文本差异，不改活动行或服务端守卫。
- `init list`、`init list json`、`init list quiet`：描述里不再写 “Python 3.11” / “Node.js 20”。
- 脚手架文件哈希不同（19）：`init case python`、`init case python no dir`、`init case python json`、`init case python quiet`、`init case node`、`init case node no dir`、`init case node json`、`init case node quiet`、`init case minimal`、`init case minimal no dir`、`init case minimal json`、`init case minimal quiet`、`init case name`、`init case name node`、`init case bad name`、`init case bad name slash`、`init existing nonempty`、`init existing force`、`init top shortcut`。模板内容是有意更新，不退回 0.2.0。

已一致、只需去掉 known 标记（不是 DIFF）：`search bad yaml`、`install invalid yaml`。

### mcp_toolerr

已展开 175 块，按内容：

| 内容 | 已展开块数 | 归组 |
|---|---:|---|
| 401 工具结果：旧版 E2000 或 httpx 401 原文，Node E1001 + 旧 suggestion | 12 | 错误码组1；suggestion 组2，已改 |
| `argument of type 'int'/'float' is not iterable`（`sandbox_id` 为 7 或 5.0） | 59 | 组1。`":" in sandbox_id` 的类型行为保持，不把数字再拼进 URL |
| 仅 `initialize` 版本 0.2.0 对 0.3.0 | 25 | 组1 |
| 字符串 id 的 404 → E2009 | 15 | 组1，KI-005 |
| envd 文件工具 → E4000 / E4001 / E3006，不再是 httpx 原文 | 30 | 组1，KI-005 / KI-004 |
| stub 请求序号或路径不一致（数字 id 提前失败，或 POST `/sandboxes` 对 GET `/sandboxes/7`） | 34 | 组1，是上面两类的请求日志 |

12 条 401 工具结果：

- `[401-json]` / `[401-code]` 的 `create_sandbox` `{}`、`create_sandbox` 带 template/timeout/envs、`run_code` `print(1)`、`run_code` 带 `sbx-missing`、`run_command`、`read_file`。

未展开的 311 条按 FAIL 行跟同一模式：

- `401-json`、`401-code` 各 89。展开的 7 块之外，其余调用同一矩阵：字符串 id 走 E1001（旧 suggestion 已改），数字 id 走 TypeError，外加版本号与 stub 日志。
- `404-json`、`404-empty`、`200-sandbox` 各 12：E2009、数字 id、版本号、stub。
- `envd-401-json`、`envd-404-json`、`envd-500-json`、`envd-500-text`、`envd-502-html`、`envd-429-json` 各 29：envd 类型化错误、数字 id、版本号、stub。
- 没有截断说明的 25 个模式共 98 块，已全部在日志里：多数是「版本号 + 整数 id + 浮点 id + stub」；`unreachable`、`dns` 各 3 块（旧版 E5001 或解析失败，Node 对数字 id 为 TypeError，外加版本号）。`dns` 的两条工具结果就是这个形状。

## 2. 该补（已改代码）

### 损坏的 config.toml 刷屏（100）

友好警告之外，同一份坏文件被按键重读，多次打印 `WARNING: Failed to load ... config.toml`（分层加载器每次解析都打，legacy 加载器再打，桥接前还有一条带时间戳的 `[WARNING]`）。

已改：

- `cli/src/transport/config.ts`：`_loadTomlFile` 对同一路径 + mtime + size 只警告一次。
- `cli/src/transport/config_layers.ts`：`loadTomlFile` 解析失败只返回 `{}`，不再打 `Failed to load`。那一行只属于 `_loadTomlFile`。

这 100 条：

- `corrupt toml` 的 9 种 list：syntax error、bad value、dup key、dup table、shortcuts not table、unterminated string、bad escape、bad date、bom。
- `set region` 的三种控制字符：`"new\nline"`、`"ctl\u0001x"`、`"del\x7fx"`。
- `warn: corrupt config + top-level --help`、`warn: corrupt config + sandbox list`、`warn: invalid utf-8 config + top-level --help`、`warn: shortcuts non-table + top-level --help`。
- `toml2 (...)` list json：bare key chars、missing equals、missing value、trailing garbage、leading zero、bad hex、bad underscore、unterminated multiline、unterminated literal、unterminated array、unterminated inline、overwrite table with value、redefine via dotted、bad header、empty header、bad unicode escape、short unicode escape、control char、nul in comment、bad time、bad datetime offset、bad bool、float no digits、float leading dot、line 5 error、unicode column、dup after dotted。
- 全部 `warn-transport (...)` sandbox list（与 toml2 同名的语法类，另加 utf-8 start byte / truncated / surrogate / overlong / bad continuation / invalid start / 4-byte bad / above max，以及 unreadable）。
- `toml2: config.toml unreadable list`。
- `round2 set {region,domain,api_url,llm_model,llm_base_url} odd value #16/#17`（10 条）和 `round2 shortcuts file: weird header spacing`。

复核（对照 oracle，只跑相关 `--only`，不改日志）：

- `--only "corrupt toml"`：65 条，0 条差异。
- `--only "warn-transport (syntax"`：0 条差异。
- `--only "warn: corrupt"`：4 条里仍有 2 条差异，但都不是刷屏。`Failed to load` 两边各一行。剩下的是版本号 0.2.0/0.3.0，以及 `sandbox list` 的 E5001 对 E1001（Node 不用 `E2B_API_URL`，打到真实 API）。这两条留在组1。

### dotenv 警告刷屏、且缺少 `WARNING:` 前缀（13）

Node 按键重读 `.env`，同一行解析失败打很多次；桥接安装前的 lastResort 没有 `WARNING:` 前缀。

已改 `cli/src/utils/_dotenv.ts`：`dotenv.main` 自带 `%(levelname)s: %(message)s`，且 `propagate = false`；同一路径 + 行号只警告一次。

这 13 条：

- `list: ./.env comments/quotes`
- `round2 set {acr_namespace,sandbox_api_key,llm_api_key,github_token,access_key_id,access_key_secret} odd value #11/#12`（12 条；#11 是未闭合双引号，#12 是单引号）

复核后不再刷屏，也有了 `WARNING:` 前缀。和旧 CLI 仍不是字节级相同，这是预期：

- `comments/quotes`：旧版约 16 行 `WARNING:`，Node 现在 1 行。旧版 python-dotenv 对多行各警告一次；Node 对同一文件同一行去重。不去掉这行警告来凑旧版行数。
- odd value #11/#12：旧版 CLI 的 list/get 不再解析这份 `.env`，stderr 为空；Node 分层 list 会再读一次，所以有 1 行 `WARNING:`。保留这一行。

### MCP / CLI 401 的 suggestion 仍写旧键名

`InvalidAPIKeyError` 的默认 suggestion 从 `Check your E2B_API_KEY environment variable or pass api_key parameter.` 改为：

`Check your EBX_SANDBOX_API_KEY environment variable or pass sandbox_api_key.`

与现有 authentication 指南同一句（没有多余的 “parameter”）。MCP `_formatToolError` 和 CLI 都抄这个类字段，所以 401 的 CLI 与 MCP 一起改。错误码仍是 E1001。

落点：

- `cli/src/models/errors.ts`
- `python-sdk/client-sdk/src/easy_sandbox/models/errors.py`（当前 SDK，不是 0.2.0 oracle；共享夹具要和活的异常类一致）
- 三份必须字节相同的 `epp-error-mapping.json`：`cli/tests/fixtures/`、`cli/docs/design/fixtures/`、`python-sdk/client-sdk/tests/fixtures/`
- `cli/tests/fixtures/error_str_oracle.json` 里 InvalidAPIKeyError 的最小变体
- `cli/parity/diff/sdk_defect_entries.mjs` 的 `AUTH_SUGG_NODE`（KI-006 匹配串跟上新句子，没有新增豁免 id）
- 引用该句的 troubleshooting（cli 与 python-sdk 的 en/zh）以及 cli 错误码表 E1001 行（en/zh）

日志里带旧句、但错误码决策属于组1的条目：上面的 sandbox 8 条 401、`process list platform 401`、template `list 401` / `info 401`、以及 MCP 已展开的 12 条 401 工具结果（未展开的 401 模式里，字符串 id 的调用同样带这句）。

## 3. 明确不改回去的东西

- 不删 `--model`，也不去掉未知选项对 `--model` 的提示。
- 不恢复 `E2B_API_KEY`、`api_url`、`AccessKey` 作为配置读写名。每个键一个名字。
- 不把 E1001 改成 E2000。
- 不把 KI-007 的空目录改回退出码 0。
- 不改活动行文件 `cli/src/agent/qwen_code.ts`、`cli/src/cli/output.ts`，不改服务端守卫。
- 不改五份差分日志。未提交、未推送。

## 改动与测试

回归（附近已有测试文件里加了两条）：

- `cli/tests/test_cli/test_config_toml_transport.test.ts`
  - `warns once for a corrupt file; the layered loader does not repeat it`
  - `warns once, with a WARNING prefix, when .env cannot be parsed`
- `cli/tests/test_models/test_errors.test.ts` 的 `test_invalid_api_key`：suggestion 含 `EBX_SANDBOX_API_KEY` 与 `sandbox_api_key`。

本轮执行：

```text
npx vitest run tests/test_cli/test_config_toml_transport.test.ts tests/test_models/test_errors.test.ts
```

2 个文件、45 条测试通过。

此前对照 oracle 的局部 harness（未重跑整份 mcp，486 条太大）：

- `config_cmds.mjs --only "corrupt toml"`：65 条，0 差异。
- `config_cmds.mjs --only "warn-transport (syntax"`：0 差异。
- `config_cmds.mjs --only "comments/quotes"`：仍差异，1 行对约 16 行，见上。
- `config_cmds.mjs --only "odd value #11"`：6 个键仍差异，Node 1 行 WARNING，Python stderr 空。
- `config_cmds.mjs --only "warn: corrupt"`：版本号与 sandbox list 的 E1001 仍差异；`Failed to load` 不再刷屏。
- `sandbox_subcmds.mjs --only "files list empty"`：3 条都是 E1001、没有 stub 请求，不是 KI-007 的 0→4 形状，所以没有写 allow-list。

更宽的 vitest（conformance / 错误类导出）里，原先就有的失败没有当成这次的回归去修：`SandboxNotFoundError` 不在旧 oracle 类清单里；若干 resolution/migration 用例仍期望已删除的 `E2B_API_KEY` 别名。那些别名按「一个键一个名字」保持删除。
