# abx 黑盒 E2E 测试套件

与语言无关的 `abx` CLI 黑盒端到端套件。它像真实用户一样启动被测二进制(argv、环境变量、stdin、退出码、
stdout/stderr、磁盘文件),并连接**真实云端**。用 `ABX_BIN` 指定要测的 `abx` 二进制。

> English version: [README.md](README.md).

## 标准 E2B 迁移契约

使用 `ABX_BIN=<独立可执行文件> npm run e2e:standard`，通过环境变量或被忽略的
.env 配置 E2B_API_KEY、E2B_API_URL/E2B_DOMAIN。这个专项测试使用真实极速版后端和
本地 PTY（Linux/macOS，需 Python 3），覆盖后台及交互创建、stdout/远程退出码、
模板 JSON 列表、持续 shell 状态、connect 所有权、自动到期与清理。它不会调用外部
E2B CLI。平台会把退出终端后的一秒超时请求取整到约 60 秒，测试会等待这一已知异步
回收过程。错误在输出前脱敏。

使用 `ABX_BIN=<独立可执行文件> node e2e/guided-configuration.mjs`，验证真实终端中的
缺少密钥引导、隐藏输入、临时配置、创建和远程执行。通过环境变量提供 Sandbox API Key
及明确的 API URL/domain。测试先从子进程环境移除密钥，再通过提示输入，使用独立的
用户目录；结束时删除自己创建的沙箱，并通过独立 HTTP 404 查询确认清理。需 Linux/macOS
和 Python 3，会创建一个真实沙箱。

构建 CLI 后，使用 `ABX_BIN=<独立可执行文件> node e2e/guided-template-steps.mjs`，
验证真实平台 RUN 构建不依赖 ACR 配置、部署进程中的 Sandbox API Key 或本地 Docker
工具。通过环境变量提供 AccessKey 和 Sandbox API Key/endpoint。测试读取现有公开
`code-interpreter-v1` 模板，保持其镜像、资源和运行命令。平台 RUN 构建仅支持 generation 2；
若该源为 generation 1，测试在任何云端写入前报告 `BLOCKED`。可通过
`ABX_GUIDED_STEPS_SOURCE_TEMPLATE_ID` 选择已验证的公开 generation-2 源继续完整测试；
需要私有镜像凭证的源会被拒绝。发布前先从现有源创建沙箱、执行命令并确认删除；随后
创建一个唯一模板和另一个沙箱，检查构建标记后删除，并通过独立 HTTP
404 查询和模板列表确认清理。`--inspect` 只读检查源；
`ABX_GUIDED_STEPS_SOURCE_TEMPLATE_ID` 可指定另一个已验证、ready、满足同样约束的公开 generation-2 源。
提交不会重放。若无法确认清理，测试失败，并保留权限为 0600、仅记录本次资源引用的
临时恢复文件；该文件不存储凭证。

常规 runner 已包含 standard-contract 和项目扩展场景。旧的参数与终端假设已调整：exec 本地参数放在 ID 前，仅在场景提供输入时连接 stdin 管道，清理使用标准 kill/list，命令遍历识别标准别名与内嵌扩展帮助。标准 template init 生成 SDK 文件，项目 template.yaml 工作流使用 template scaffold。专项通过不代表完整 CI 矩阵通过。

## 快速开始

```bash
# 1. 凭据:环境变量或 git 忽略的 cli/.env(绝不提交、绝不打印)
#    E2B_API_KEY, E2B_API_URL, E2B_DOMAIN, ALICLOUD_ACCESS_KEY_ID/ALICLOUD_ACCESS_KEY_SECRET, ACR_NAMESPACE, ABX_LLM_API_KEY, ABX_LLM_BASE_URL
cp .env.example .env   # 然后填入真实值

# 2. 对 abx 二进制运行
ABX_BIN=abx                           npm run e2e          # PATH 上的 `abx`(默认)
ABX_BIN="node $PWD/dist/bin/abx.js"   npm run e2e          # `npm run build` 之后

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

## 云端命令合同

`cloud-readonly` 和 `cloud-lifecycle` 使用标准 detached create、list/info JSON
（`--format json`）、状态过滤（`--state`）和 kill 合同。项目 JSON exec、quiet/CI
输出及创建时 env/上传检查使用显式 `--native` 入口。测试将同一选定账户分别通过标准
`E2B_*` 与项目规范 `ABX_SANDBOX_*` 设置传入，负例凭据覆盖同时作用于两者。
这只是测试配置，不是产品兼容别名。创建操作不自动重放，提交前先持久化未决意图；获得真实 ID 后立即登记，明确的模板不存在拒绝
可以不产生 ID 地解除意图。超时或含糊结果保留未决意图，并使最终检查失败。kill 确认本身
不能证明资源消失，只有有效的标准清单可以确认缺席。runner 与 `cleanup.mjs --yes` 都会
保留未决创建和未确认 ID，并记录部分清理进度。

具名命令检查要求选定的已部署 `python-hello` 模板实现应用协议 v2 和文档中的 `hello`
命令。未设置 `ABX_E2E_APP_START_COMMAND` 时，要求服务已经启动。对裸 managed 沙箱上的
`startup: exec` 工作流，必须显式传入经检查的当前 manifest 原样启动命令；当前
python-hello 为：

```bash
ABX_E2E_APP_START_COMMAND="agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py" \
  ABX_BIN=abx node e2e/run.mjs --suite cloud-readonly,cloud-lifecycle
```

若选定的 managed 镜像没有包含经检查的当前应用文件，可显式同时设置
`ABX_E2E_APP_UPLOAD_SOURCE`、`ABX_E2E_APP_UPLOAD_DEST` 和上述启动命令。
先将 `PYTHON_HELLO_SOURCE` 设置为经检查的
[python-hello 源码目录](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/main/python-hello)：

```bash
ABX_E2E_APP_UPLOAD_SOURCE="$PYTHON_HELLO_SOURCE/commands.py" \
ABX_E2E_APP_UPLOAD_DEST="/home/user/app/commands.py" \
ABX_E2E_APP_START_COMMAND="agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py" \
  ABX_BIN=abx node e2e/run.mjs --suite cloud-readonly,cloud-lifecycle
```

应用变更前先验证参数配对。文件仅上传一次至本轮自有沙箱，上传失败不启动服务。
验收记录必须写明选定源码版本及字节哈希。该模式验证 managed 沙箱加上传的当前应用
及 CLI 调用桥接，不表示原镜像已预装该文件，也不证明 Express 源码镜像构建可用。

启动只执行一次，必须获得真实且可见的进程 ID，之后才允许协议 v2 目录和命令载荷调用。
不猜测其他路径、启动命令或协议，不重复重启。服务缺失或协议不兼容会使检查失败。进程信号仅作用于本轮创建的进程，验证清单内每个进程 ID 后才判断其消失。即使真实
exec/files 检查通过，发现接口也可以没有声明粗粒度分组，测试不再推断 shell/files 基线。
metrics 和 pip 包清单使用现行结构化 JSON 合同。原生模板 info 从同账户原生清单取得
真实 TemplateID，模板不存在检查严格验证当前 E5000 和指定 API/404 诊断。交互式 create/connect
仍由 `e2e/standard.mjs` 使用真实本地 PTY 覆盖。

## 套件

| 套件 | 依赖 | 内容 |
|---|---|---|
| `offline` | 无 | `--version`、各命令组 `--help`、用法错误(退出码 2)、缺少凭据(退出码 3,`E1001`)、`config get/set/list/delete/init`、固定的顶层命令集（已移除的写法退出码 2）、向临时 HOME 写入 MCP `install/status/stop`、`template scaffold`、本地 `template search --index-url` |
| `standard-contract` | 云端 + Python 3/本地 PTY | 固定 E2B 生命周期、远程退出码、真实 PTY/connect 所有权、自动到期及清理 |
| `cloud-readonly` | 云端 | 标准认证与列表、显式原生错误信封、官方真实 TemplateID 回读与精确不存在诊断、`config list` 密钥脱敏 |
| `cloud-lifecycle` | 云端 | `create` → `list` → `info` → `exec`(退出码透传、`--cwd`、显式 native JSON/quiet/CI、标准 `CI=true`、不支持的超时选项拒绝)→ `upload`/`download`(二进制往返)→ 后台/流式执行/命令 env → `sandbox files/process/system/capabilities` → `sandbox command list` / `run` 具名命令 → 创建时注入 env/上传 → `kill` |
| `catalog` | 可访问 GitHub | 针对远程索引的 `template search` 与 `template install --download-only` |
| `docker-deploy` | 云端 + Docker,需主动开启 | `template scaffold` → `template deploy`(docker build、ACR push、CreateTemplate)→ `create` → `exec` → `template delete` |

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

实际挂载验收单独运行 `--suite volume-mount-cloud`，设置 `ABX_E2E_VOLUME_MOUNT=1`、
指向已有可写测试 Volume 的 `ABX_E2E_VOLUME_NAME`，以及 `/mnt/abx-e2e/` 下专用的规范
挂载路径 `ABX_E2E_VOLUME_MOUNT_PATH`。配置的沙箱 API Key 必须属于 Volume 所在 Team，
并具有有效存储角色。场景先通过 `/proc/self/mountinfo` 确认精确挂载，再独占创建、读写、
删除自己的哨兵文件，最后销毁自己的沙箱，不删除既有 Volume 或底层存储。缺少条件标为
skip，不代表挂载已通过。

请显式设置 `ABX_E2E_TEMPLATE`，选择支持挂载的模板。自定义 MicroVM 源镜像必须预装
ossfs2 2.0.10 或以上版本，参见[官方挂载指南](https://help.aliyun.com/zh/agent-sandbox/mount-oss-volume-1)。
明确授权创建测试基础设施后，可用临时私有 Bucket、仅有该 Bucket 权限且信任 FC 的专用
RAM 角色、同一 Team 的测试 API Key 和 Volume 准备前提。沙箱清理后，依次停用并删除测试
Key、删除 Volume、清空并删除测试 Bucket、解绑并删除自定义策略、删除测试角色，逐项查询
确认不存在。这些创建与清理步骤独立于挂载套件，套件本身不创建存储或删除已有 Volume。

管理命令检查可运行 `--suite provider-commands-offline,provider-management-cloud`。
前者无需凭证，后者用 AK/SK 验证四类 FC 只读 API，均不创建资源。
临时 API Key 生命周期使用 `--suite provider-management-lifecycle --filter existing-team-api-key-lifecycle`，
并设置 `ABX_E2E_PROVIDER_MANAGEMENT_WRITE=1` 与明确的 `ABX_E2E_MANAGEMENT_EXISTING_TEAM_ID`。
只创建、更新、轮换、停用和删除本次随机命名的 key，不修改已有 Team；密钥仅写入临时 0600 文件，不打印。
新 Team、Volume、配额的写入场景还要求源码注明的计划、资源组和额外开关；缺前提会报告跳过，
不会猜测订阅计划、创建底层存储或尝试未公开的 Volume 状态转换。

| 变量 | 含义 |
|---|---|
| `ABX_BIN` | 被测二进制(默认 `abx`),可带参数,如 `"node $PWD/dist/bin/abx.js"`；临时场景工作目录要求脚本使用绝对路径 |
| `ABX_E2E_TEMPLATE` | 生命周期套件使用的模板(默认 `python-hello`) |
| `ABX_E2E_TEMPLATE_ID` | 可选真实原生 TemplateID，官方 info 回读时要求它存在于选定账户清单 |
| `ABX_E2E_APP_UPLOAD_SOURCE` / `ABX_E2E_APP_UPLOAD_DEST` | 可选、必须成对的经检查本地应用文件和明确远端路径；要求显式启动命令，只在启动前上传一次 |
| `ABX_E2E_APP_START_COMMAND` | 可选的选定 manifest 原样启动命令，只运行一次并验证真实 PID；不设置则要求应用已启动 |
| `ABX_E2E_TIMEOUT_MS` | 每条命令默认超时(默认 120000) |
| `ABX_E2E_DOCKER=1` | 启用 Docker/ACR 套件(慢,会消耗真实资源) |
| `ABX_E2E_ALLOW_KILL_ALL=1` | 启用 `kill --all` 确认保护场景(共享账号下危险) |
| `ABX_E2E_KEEP=1` | 保留临时工作目录以便调试(可能含命令输出,不含凭据) |

## 结果与基线

[`BASELINE.md`](BASELINE.md) 记录了每个场景在真实云端上的通过、失败和抖动情况。改一个命令时,
对要发布的二进制再跑一遍套件,并和基线比较。

mock 对比 oracle 的差分工具位于 [`../parity/diff/`](../parity/diff/README.zh-CN.md)。

`run.mjs` 退出码:0 = 无失败(允许跳过),1 = 至少一个失败,2 = 二进制不可运行。

## 无云端前提的 Provider 归属验证

`ABX_BIN=<构建后的可执行文件> node e2e/provider-boundary.mjs` 向临时 HOME 安装本地测试插件，检查带前缀资源、冲突/未知/空前缀、远程 Provider 参数，以及模板/部署的拒绝路径。它使用真实可执行文件和文件系统，不创建云端资源；它不等同于真实 OpenSandbox 部署验证。
## MCP 生命周期真实验证

构建后运行 `node e2e/mcp-lifecycle.mjs`。凭据仅经环境变量传入。脚本启动真实 CLI STDIO 进程，验证创建、列表、元数据、续期、文件与命令，以及外部观察者退出不销毁资源；finally 仅清理本次创建的 ID 并只读核对无残留。仅列表的已知最终一致可见性会重试。

## 极速版源码工作流实测

在已启动 Docker 的主机执行 `npm ci && npm run build`，再运行
`node e2e/express-workflow.mjs`。通过环境变量配置 `ABX_SANDBOX_API_KEY`、
`ABX_SANDBOX_BASE_URL`、`ABX_SANDBOX_DOMAIN`、`ALICLOUD_ACCESS_KEY_ID`、
`ALICLOUD_ACCESS_KEY_SECRET`、`ALIBABA_CLOUD_REGION_ID` 和 `ACR_NAMESPACE`。
账号需要对应 ACR 命名空间的推送权限及极速版模板的创建、删除权限。
`ABX_WORKFLOW_REPORT` 指定 JSON 报告路径；`ABX_WORKFLOW_FULL_E2E=1`
可追加运行基于该模板的完整 CLI 测试套件。

脚本直接使用 Registry 的 `python-hello` 源码及默认 Dockerfile，核对返回的服务，验证 HTTP
命令和 CLI 文件操作，并删除本次创建的沙箱、模板，通过独立的结构化不存在错误核对清理。此操作会产生云资源费用。
ACR 镜像资源记录保留于 `~/.abx/resource-journal/`，供手动清理镜像；不要删除
共享镜像仓库。脱敏报告分别记录测试结果和清理状态。

Actions 工作流通过加密的 `EXPRESS_ACCEPTANCE_*` 仓库 Secrets 注入配置
（具体映射见工作流），仅在 `EXPRESS_ACCEPTANCE_ENABLED=true` 时执行云端步骤。
未开启时为跳过，构建通过不代表云端实测通过。仅同仓库 PR 和手动触发可执行该任务。

## 模板整体启动验收

构建候选 CLI 后，设置环境中的沙箱密钥和阿里云 AccessKey，执行 `ABX_BIN="node $PWD/dist/bin/abx.js" node e2e/unified-template-launch.mjs`。先启动 spec v5 托管 base 模板，再用固定官方基础镜像和原生 steps 准备源码模板，启动两个 HTTP 服务、检查就绪、核对全部返回地址，并远程检查构建标记。脚本只清理资源日志中本次创建的沙箱和模板，并确认已不存在。`--managed-only` 跳过源码准备。本测试只覆盖极速版重点路径，不代表全部 Docker/OpenSandbox 模板矩阵；测试期间不要同时重建 dist。

## MCP 生命周期的规格期望

构建后运行 `node e2e/mcp-lifecycle.mjs`，通过真实 CLI STDIO server 检查资源归属、独立元数据查询、存活时间、文件和命令。用 `ABX_E2E_TEMPLATE` 选择已准备好的模板，并用 `ABX_E2E_CPU`、`ABX_E2E_MEMORY` 指定实际规格期望值（默认为 `base`、2 CPU、2048 MB）。创建参数和随后独立查询的规格必须都符合期望。执行和清理保留 Provider 限定 ID；元数据和列表比较使用解析后的原始 ID。
