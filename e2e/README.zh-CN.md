# abx 黑盒 E2E 测试套件

与语言无关的 `abx` CLI 黑盒端到端套件。它像真实用户一样启动被测二进制(argv、环境变量、stdin、退出码、
stdout/stderr、磁盘文件),并连接**真实云端**。用 `ABX_BIN` 指定要测的 `abx` 二进制。

> English version: [README.md](README.md).

## 快速开始

```bash
# 1. 凭据:环境变量或 git 忽略的 cli/.env(绝不提交、绝不打印)
#    ABX_SANDBOX_API_KEY, ABX_SANDBOX_BASE_URL, ABX_SANDBOX_DOMAIN, ALICLOUD_ACCESS_KEY_ID/ALICLOUD_ACCESS_KEY_SECRET, ACR_NAMESPACE, ABX_LLM_API_KEY, ABX_LLM_BASE_URL
cp .env.example .env   # 然后填入真实值

# 2. 对 abx 二进制运行
ABX_BIN=abx                           npm run e2e          # PATH 上的 `abx`(默认)
ABX_BIN="node dist/bin/abx.js"        npm run e2e          # `npm run build` 之后

npm run e2e:offline                   # 仅无需凭据的套件(几秒)
node e2e/run.mjs --suite cloud-lifecycle --filter 'exec|files'
node e2e/run.mjs --list               # 列出所有套件与场景
node e2e/run.mjs --json out.json --markdown out.md   # 机器/Markdown 报告(已脱敏)
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
| `offline` | 无 | `--version`、各命令组 `--help`、用法错误(退出码 2)、缺少凭据(退出码 3,`E1001`)、`config get/set/list/delete/init`、固定的顶层命令集（已移除的写法退出码 2）、向临时 HOME 写入 MCP `install/status/stop`、`template init`、本地 `template search --index-url` |
| `cloud-readonly` | 云端 | 错误 API Key(`E1000`,退出码 3)、`template list/info/delete` 与 not-found 信封(退出码 4,`E2001`/`E5000`)、`list` 输出结构、`config list` 密钥脱敏 |
| `cloud-lifecycle` | 云端 | `create` → `list` → `info` → `exec`(退出码透传、`--cwd`、`--json`、`-q`、`--ci`、`CI=true`、超时→退出码 5)→ `upload`/`download`(二进制往返)→ `exec --background/--stream/--env` → `sandbox files/process/system/capabilities` → `connect` → `sandbox command list` / `run` 具名命令 → 创建时注入 env/上传 → `kill` |
| `catalog` | 可访问 GitHub | 针对远程索引的 `template search` 与 `template install --download-only` |
| `docker-deploy` | 云端 + Docker,需主动开启 | `template init` → `template deploy`(docker build、ACR push、CreateTemplate)→ `create` → `exec` → `template delete` |

## 场景格式

场景是 `scenarios/*.mjs` 中的普通对象(表格风格),常用字段:`id`、`title`、`requires`(依赖场景通过才运行)、
`argv`(数组或函数)、`env`、`stdin`、`creds:false`、`freshHome`、`exit`(数字 | 数组 | `'nonzero'`)、
`stdout`/`stderr`/`output`(字符串、正则、`{ not: ... }`)、`jsonShape`/`json`(JSON 断言)、`retries`/`retryReason`、
`timeoutMs`、`needs`。多步骤场景使用 `run(ctx)`:`ctx.abx`(脱敏+规范化结果)、`ctx.rawAbx`(仅脱敏)、
`ctx.track/untrack`(登记待清理沙箱)、`ctx.eventually`、`ctx.fail`。详见英文版示例。

## Provider 分级

每个 provider，包括 OpenSandbox，都按同一套六级测试（T0 插件单测，直到 T5 真实阿里云）。表格、规则和命令见 [providers/PLAN.zh-CN.md](providers/PLAN.zh-CN.md)（[English](providers/PLAN.md)）。

## 提供商插件（`e2e/providers/run.sh`）

一个 bash 脚本：把参考插件安装到一次性的 `HOME`，并通过 CLI 驱动真实沙箱。运行方式：`npm run e2e:providers` 或 `e2e/providers/run.sh [offline|catalog|local-process|opensandbox|e2b-compatible]`。`local-process`（`exec` 插件，Python）与 `e2b-compatible`（`rest` 清单）来自 `python-sdk/examples/providers`。`opensandbox` 是目录里的 `node` 插件（`provider.mjs`，`create(kit)`），从 [awesome-providers](https://github.com/alibaba-agent-sandbox/awesome-providers) 克隆（`opensandbox/` 目录）。另外三个目录 id（`e2b`、`cubesandbox`、`alicloud-container`）也是那棵树里的 `node` 插件。`catalog` 目标安装的是 `awesome-providers//opensandbox`。

| 目标 | 依赖 | 检查内容 |
|---|---|---|
| `offline` | 无（git、python3） | “用到才出现”的 `provider` 命令组、同意界面与 `--yes` 规则（`E8012`）、从路径安装与从钉住 commit 的本地 git 仓库安装、`E8003` 冲突与 `--force`、`doctor`/`info`、`E8001`、`E8002`（命令行传密钥）、`provider default`、`E8030`、篡改检测（`E8011`）、卸载 |
| `local-process` | python3 | `create`、`list`、`exec`（退出码透传）、`upload`/`download` 往返、`sandbox files list`、`kill`、终止后返回退出码 4，全程使用限定 id |
| `opensandbox` | 运行中的 OpenSandbox：`python-sdk/e2e/opensandbox/local-up.sh`（Docker；密钥 `local-dev-key`，`127.0.0.1:8080`） | 按路径与按 git 安装、`doctor`、`provider default opensandbox`、带与不带 `--provider` 的完整沙箱往返、密钥掩码，以及 `abx provider test`（契约套件） |
| `e2b-compatible` | 环境中的 `E2B_API_KEY`（及 `E2B_API_URL`、`E2B_DOMAIN`） | REST 插件继承通用 `sandbox_*` 键，在真实云上跑同一往返；没有密钥时报告为 `SKIP` |

变量：`ABX_BIN`（被测二进制，检出仓库中默认为 `tsx src/bin/abx.ts`）、`PROVIDERS_DIR`（仅 local-process 与 e2b-compatible）、`OSB_SRC` 或 `ABX_OPENSANDBOX_PLUGIN` 或 `ABX_AWESOME_PROVIDERS`（opensandbox 检出；否则脚本克隆目录仓库）、`OSB_URL`、`OSB_KEY`、`OSB_IMAGE`。脚本会清理子进程环境，从不打印凭证，退出时终止它创建的所有沙箱，任何步骤失败都以非零退出。

## 环境变量

管理命令检查可运行 `--suite provider-commands-offline,provider-management-cloud`。
前者无需凭证，后者用 AK/SK 验证四类 FC 只读 API，均不创建资源。
临时 API Key 生命周期使用 `--suite provider-management-lifecycle --filter existing-team-api-key-lifecycle`，
并设置 `ABX_E2E_PROVIDER_MANAGEMENT_WRITE=1` 与明确的 `ABX_E2E_MANAGEMENT_EXISTING_TEAM_ID`。
只创建、更新、轮换、停用和删除本次随机命名的 key，不修改已有 Team；密钥仅写入临时 0600 文件，不打印。
新 Team、Volume、配额的写入场景还要求源码注明的计划、资源组和额外开关；缺前提会报告跳过，
不会猜测订阅计划、创建底层存储或尝试未公开的 Volume 状态转换。

| 变量 | 含义 |
|---|---|
| `ABX_BIN` | 被测二进制(默认 `abx`),可带参数,如 `"node dist/bin/abx.js"` |
| `ABX_E2E_TEMPLATE` | 生命周期套件使用的模板(默认 `python-hello`) |
| `ABX_E2E_TIMEOUT_MS` | 每条命令默认超时(默认 120000) |
| `ABX_E2E_DOCKER=1` | 启用 Docker/ACR 套件(慢,会消耗真实资源) |
| `ABX_E2E_ALLOW_KILL_ALL=1` | 启用 `kill --all` 确认保护场景(共享账号下危险) |
| `ABX_E2E_KEEP=1` | 保留临时工作目录以便调试(可能含命令输出,不含凭据) |

## 结果与基线

[`BASELINE.md`](BASELINE.md) 记录了每个场景在真实云端上的通过、失败和抖动情况。改一个命令时,
对要发布的二进制再跑一遍套件,并和基线比较。

mock 对比 oracle 的差分工具位于 [`../parity/diff/`](../parity/diff/README.zh-CN.md)。

`run.mjs` 退出码:0 = 无失败(允许跳过),1 = 至少一个失败,2 = 二进制不可运行。
