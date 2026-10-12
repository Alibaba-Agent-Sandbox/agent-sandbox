# SDK 缺陷修复的真实云端验证(KI-001 .. KI-008)

> English: [README.md](README.md).

Python SDK 已修复 `python-sdk/e2e/KNOWN-ISSUES.md` 记录的缺陷(KI-001 .. KI-007、KI-010);Node CLI 移植了同样的修复
(见 `CHANGELOG.md` Unreleased > Fixed 与 `parity/sdk-defect-fixes.md`)。单元测试
(`tests/test_known_issues/ki00N_*.test.ts`)用 mock 传输固定线上报文形态,`run.mjs` 则在**真实平台和真实 envd**
上证明相同行为,对应 `python-sdk/e2e/test_03_commands.py` 与 `test_04_files_envd.py` 中的已知问题测试。

```bash
npm run build                                   # SDK 场景会导入 dist/(可用 EBX_SDK_DIST 覆盖)
EBX_BIN="node dist/bin/ebx.js" node e2e/known-issues/run.mjs
EBX_BIN="node dist/bin/ebx.js" node e2e/known-issues/run.mjs --filter 'KI-004|ki003' --json out.json
```

凭据来自环境变量或被 git 忽略的 `cli/.env`(`E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`),绝不打印(所有捕获的输出
都会脱敏)。没有凭据时脚本打印 `SKIP: ...` 并以 0 退出。`EBX_E2E_TEMPLATE` 指定模板(默认 `python-hello`)。

## 做了什么

通过 CLI 创建一个沙箱(`create --template ... --timeout 900`),并在 `finally`、SIGINT/SIGTERM 以及 `e2e/.state/`
台账中保证删除(`npm run e2e:cleanup` 是清理工具)。运行前后各列一次账户沙箱,如有残留则失败
(`leak check: ... leaked=0`)。

| 场景 | KI | 检查内容(除特别说明外均通过 CLI) |
|---|---|---|
| `ki001-per-call-env` | 001 | SDK `commands.run(..., { env })`:变量到达命令(`envs`,而非 `envVars`) |
| `ki002-prepare` | 002 | 用 `ebx sandbox files mkdir` / `upload` 构造目录树 |
| `ki002-list-json-reports-directories` | 002 | `files list --json`:目录为 `directory`,文件为 `file`,名称与大小真实 |
| `ki002-stat-directory-and-file` | 002 | `files stat --json`:真实的 `Name`/`Path`/`Type`/`Size`(嵌套 `entry`) |
| `ki007-list-missing-directory` | 007 | 缺失目录的 `files list`:退出码 4,`E4001`(envd 返回 HTTP 200 且无条目) |
| `ki007-list-empty-directory-still-ok` | 007 | 已存在空目录的 `files list`:退出码 0 |
| `ki005-stat-missing-file` | 005 | 缺失路径的 `files stat`:退出码 4,`E4001` |
| `ki005-download-missing-file` | 005 | 下载缺失文件:退出码 4,`E4001`,不写出文件 |
| `ki005-missing-sandbox` | 005 | 未知沙箱的 `info` / `exec`:退出码 4,`E2009` |
| `ki006-bad-api-key` | 006 | 错误 API Key:退出码 3,`E1001`(`list` 与 `create`),Key 不出现在输出中 |
| `ki003-sdk-timeout-kills-the-process` | 003 | SDK `run("sleep 113", { timeout: 3 })`:`CommandTimeoutError`(`E3001`),进程已被终止 |
| `ki003-cli-exec-timeout` | 003 | `ebx exec --timeout 3 "sleep 114"`:退出码 5,`E3001`,进程已被终止 |
| `ki004-sdk-kill` | 004 | SDK `commands.kill(pid)` 终止运行中的进程 |
| `ki004-sdk-send-input` | 004 | SDK `commands.sendInput` 送达运行中的 `head -n 1` 的标准输入 |
| `ki004-cli-unsupported-signal` | 004 | `ebx sandbox process signal --signal 2`:在发送任何请求前就被拒绝并给出 envd 的说明 |

逐次调用的环境变量、后台进程和 stdin 没有对应的 `ebx` 命令,这些场景使用与 `EBX_BIN` 同一份源码构建的 Node SDK
(`EBX_SDK_DIST`,默认 `<repo>/dist`)。

## 黑盒套件中的相关改动

`e2e/scenarios/` 中的套件同样会对原始 Python `ebx` 运行,因此输出随修复而变化的场景同时接受两种形式
(`404` 或 `E4001`/`E2009`,`E1000` 或 `E1001`):`auth-wrong-key*`、`info-missing-sandbox`、`exec-missing-sandbox`、
`kill-missing-sandbox`、`kill-twice`、`download-missing-remote`、`files-stat-missing`。
