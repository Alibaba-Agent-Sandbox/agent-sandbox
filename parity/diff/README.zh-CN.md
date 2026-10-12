# mock 对比 oracle 差分工具

对两个 `ebx` 二进制运行**完全相同的 argv**,并比较所有可观察结果:退出码、规范化后的 stdout/stderr、写入的文件
(配置、MCP 配置、下载文件),以及各自发往确定性云端 stub 的 **HTTP 流量**。无需云账号,一分钟内即可回答
"移植版的行为是否与 Python oracle 完全一致"。

> English version: [README.md](README.md).

```bash
EBX_ORACLE=/path/to/python/venv/bin/ebx \
EBX_BIN="node dist/bin/ebx.js" \
node parity/diff/diff.mjs [--filter regex] [--fast] [--verbose] [--show] [--out reports/dir] [--list]

EBX_ORACLE=... node parity/diff/selftest.mjs     # 证明工具能发现故意引入的回归
EBX_ORACLE=X EBX_BIN=X node parity/diff/diff.mjs # oracle 对比自身:必须 0 差异
```

| 文件 | 作用 |
|---|---|
| `stub.mjs` | 单个 HTTP 服务:平台 REST(`/sandboxes`、`/templates`)与 envd Connect RPC(`/process.Process/*` 流式帧、`/filesystem.Filesystem/*`、`/files`)。响应携带指向 stub 自身的 `envdUrl`;内置小型命令模拟器处理 `echo`、`ls`、`exit N`、未知可执行文件(HTTP 500)与 `sleep`(挂起,用于超时用例)。可按用例注入 401/404/429/500 故障,并记录每个请求。 |
| `cases.mjs` | 120 个用例(88 个源自原版 100 例 evidence 注册表 `tests/test_cli_evidence`,另 32 个为沙箱 files/process、kill/exec 变体与仅 stub 可构造的故障场景),每个用例记录 `evidence` 出处。 |
| `diff.mjs` | 运行器:每个用例、每个二进制使用全新 HOME/cwd,重置 stub 世界,执行 argv,规范化输出(沙箱 ID、时间戳、耗时、临时路径、stub 地址、MCP 配置中的二进制路径)后比较。`--fast` 跳过需要等待超时/重试的用例。 |
| `selftest.mjs` | 将 oracle 与"突变包装器"(改写一个词、改变退出码)对比,验证工具恰好报告这些用例。 |

规范化刻意保持狭窄:上述之外的内容逐字节比较。`wire: false` 的用例(离线用例)只比较输出与产物。

**不覆盖**:管道 stdin 之外的交互提示、AI 生成、Docker/ACR、长时间运行输出的时序、真实网关的 TLS/HTTP2 行为。
这些请使用 [`../../e2e/`](../../e2e/README.zh-CN.md) 中的真实云端套件。

报告(`--out`)输出为 `diff-report.json` 与 `diff-report.md`,仅含规范化输出(stub 凭据为假值)。
