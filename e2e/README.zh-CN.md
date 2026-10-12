# ebx 黑盒 E2E 测试套件

与语言无关的 `ebx` CLI 黑盒端到端套件。它像真实用户一样启动被测二进制(argv、环境变量、stdin、退出码、
stdout/stderr、磁盘文件),并连接**真实云端**,因此可以验证任意实现:原版 Python CLI(行为基准 / oracle)、
Node.js/TypeScript 移植版,或未来的重写版本。

> English version: [README.md](README.md).

## 快速开始

```bash
# 1. 凭据:环境变量或 git 忽略的 cli/.env(绝不提交、绝不打印)
#    E2B_API_KEY, E2B_API_URL, E2B_DOMAIN, AccessKey/AccessSecret, ACR_NAMESPACE, OPENAI_API_KEY, OPENAI_BASE_URL
cp .env.example .env   # 然后填入真实值

# 2. 对任意二进制运行
EBX_BIN=ebx                           npm run e2e          # PATH 上的 `ebx`(默认)
EBX_BIN="node dist/bin/ebx.js"        npm run e2e          # `npm run build` 之后的 Node 移植版
EBX_BIN=/path/to/venv/bin/ebx         npm run e2e          # Python oracle

npm run e2e:offline                   # 仅无需凭据的套件(几秒)
node e2e/run.mjs --suite cloud-lifecycle --filter 'exec|files'
node e2e/run.mjs --list               # 列出所有套件与场景
node e2e/run.mjs --json out.json --markdown out.md   # 机器/Markdown 报告(已脱敏)
npm run e2e:known-issues              # SDK 缺陷修复 KI-001..KI-008 的真实云端验证(见 known-issues/README.zh-CN.md)
npm run e2e:cleanup                   # 清理被中断运行遗留沙箱的 janitor(默认 dry-run)
```

需要 Node >= 20,套件本身不安装任何依赖。

## 保证

| 关注点 | 处理方式 |
|---|---|
| 隔离 | 每个套件/场景使用系统临时目录下全新的 `HOME`(及 cwd),`XDG_CONFIG_HOME` 位于其中;不读写真实 home 或仓库。仅继承 `PATH`、locale、代理/CA 变量。 |
| CI 自动模式 | 不转发 `CI`、`GITHUB_ACTIONS` 等变量,避免 CLI 悄悄切换到 `--json/--quiet`;需要时由场景显式设置 `CI=true`。 |
| 密钥 | 来自环境变量 / `cli/.env`,只传给子进程。捕获的每个字节在存储、打印、比较前都会脱敏(`<SECRET>`、`<HOST>`、`<DOMAIN>`,以及 `abc***xyz` 形式的部分脱敏值)。报告不含任何凭据。 |
| 清理 | 运行创建的每个沙箱都会被追踪,在 `finally`/信号处理中销毁,并在确认删除前记录于 `e2e/.state/run-<id>.json`。内置的 `leak-check` 场景最后会列出账号下沙箱,若仍有被追踪的沙箱则失败。默认从不使用 `kill --all`。 |
| 确定性 | 输出会被规范化(沙箱 ID、时间戳、耗时、容器 ID、临时路径、uptime);平台不保证顺序处注意使用与顺序无关的匹配;仅对已知最终一致的操作重试,按场景声明(`retries`、`ctx.eventually`),并在需要时于报告中标注。 |
| 跳过 | 无法运行的套件/场景会以 `SKIP` 及确切原因报告(缺少凭据、GitHub 索引不可达、Docker 需主动开启等),绝不静默变绿。 |

## 套件

| 套件 | 依赖 | 内容 |
|---|---|---|
| `offline` | 无 | `--version`、各命令组 `--help`、用法错误(退出码 2)、缺少凭据(退出码 3,`E1001`)、`config get/set/list/delete/init`、shortcuts、向临时 HOME 写入 MCP `install/status/stop`、`template init`、本地 `template search --index-url` |
| `cloud-readonly` | 云端 | 错误 API Key(`E1000`,KI-006 修复后为 `E1001`;退出码 3)、`template list/info/delete` 与 not-found 信封(退出码 4,`E2001`/`E5000`)、`list` 输出结构、`config list` 密钥脱敏 |
| `cloud-lifecycle` | 云端 | `create` → `list` → `info` → `exec`(退出码透传、`--cwd`、`--json`、`-q`、`--ci`、`CI=true`、超时→退出码 5)→ `upload`/`download`(二进制往返)→ `sandbox files/process/system/capabilities/shell-stream` → `connect` → `run` 自定义命令 → 创建时注入 env/上传 → `kill` |
| `catalog` | 可访问 GitHub | 针对远程索引的 `template search` 与 `template install --download-only` |
| `docker-deploy` | 云端 + Docker,需主动开启 | `template init` → `template deploy`(docker build、ACR push、CreateTemplate)→ `create` → `exec` → `template delete` |

## 场景格式

场景是 `scenarios/*.mjs` 中的普通对象(表格风格),常用字段:`id`、`title`、`requires`(依赖场景通过才运行)、
`argv`(数组或函数)、`env`、`stdin`、`creds:false`、`freshHome`、`exit`(数字 | 数组 | `'nonzero'`)、
`stdout`/`stderr`/`output`(字符串、正则、`{ not: ... }`)、`jsonShape`/`json`(JSON 断言)、`retries`/`retryReason`、
`timeoutMs`、`needs`。多步骤场景使用 `run(ctx)`:`ctx.ebx`(脱敏+规范化结果)、`ctx.rawEbx`(仅脱敏)、
`ctx.track/untrack`(登记待清理沙箱)、`ctx.eventually`、`ctx.fail`。详见英文版示例。

## 提供商插件（`e2e/providers/run.sh`）

一个 bash 脚本：把 `python-sdk/examples/providers` 中的参考插件安装到一次性的 `HOME`，并通过 CLI 驱动真实沙箱。运行方式：`npm run e2e:providers` 或 `e2e/providers/run.sh [offline|local-process|opensandbox|e2b-compatible]`。

| 目标 | 依赖 | 检查内容 |
|---|---|---|
| `offline` | 无（git、python3） | “用到才出现”的 `provider` 命令组、同意界面与 `--yes` 规则（`E8012`）、从路径安装与从钉住 commit 的本地 git 仓库安装、`E8003` 冲突与 `--force`、`doctor`/`info`、`E8001`、`E8002`（命令行传密钥）、`provider default`、`E8030`、篡改检测（`E8011`）、卸载 |
| `local-process` | python3 | `create`、`list`、`exec`（退出码透传）、`upload`/`download` 往返、`sandbox files list`、`kill`、终止后返回退出码 4，全程使用限定 id |
| `opensandbox` | 运行中的 OpenSandbox：`python-sdk/e2e/opensandbox/local-up.sh`（Docker；密钥 `local-dev-key`，`127.0.0.1:8080`） | 按路径与按 git 安装、`doctor`、`provider default opensandbox`、带与不带 `--provider` 的完整沙箱往返、密钥掩码，以及 `ebx provider test`（契约套件） |
| `e2b-compatible` | 环境中的 `E2B_API_KEY`（及 `E2B_API_URL`、`E2B_DOMAIN`） | REST 插件继承通用 `sandbox_*` 键，在真实云上跑同一往返；没有密钥时报告为 `SKIP` |

变量：`EBX_BIN`（被测二进制，检出仓库中默认为 `tsx src/bin/ebx.ts`）、`PROVIDERS_DIR`、`OSB_URL`、`OSB_KEY`、`OSB_IMAGE`。脚本会清理子进程环境，从不打印凭证，退出时终止它创建的所有沙箱，任何步骤失败都以非零退出。

## 环境变量

| 变量 | 含义 |
|---|---|
| `EBX_BIN` | 被测二进制(默认 `ebx`),可带参数,如 `"node dist/bin/ebx.js"` |
| `EBX_E2E_TEMPLATE` | 生命周期套件使用的模板(默认 `python-hello`) |
| `EBX_E2E_TIMEOUT_MS` | 每条命令默认超时(默认 120000) |
| `EBX_E2E_DOCKER=1` | 启用 Docker/ACR 套件(慢,会消耗真实资源) |
| `EBX_E2E_ALLOW_KILL_ALL=1` | 启用 `kill --all` 确认保护场景(共享账号下危险) |
| `EBX_E2E_KEEP=1` | 保留临时工作目录以便调试(可能含命令输出,不含凭据) |

## 结果与基线

[`BASELINE.md`](BASELINE.md) 记录了针对 Python oracle 在真实云端上每个场景的通过/失败/抖动情况。移植某个命令时,
请对两个二进制都运行套件并与基线比较;oracle 通过而移植版失败即为一致性缺陷(或场景过度约束,此时请在同一变更中修正场景)。

mock 对比 oracle 的差分工具位于 [`../parity/diff/`](../parity/diff/README.zh-CN.md)。

`run.mjs` 退出码:0 = 无失败(允许跳过),1 = 至少一个失败,2 = 二进制不可运行。
