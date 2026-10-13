# 编写提供商

提供商插件是一个目录，包含 `abx-provider.toml` 清单；对于 `exec` 类型，还包含一个使用 **EPP/1**（JSON-RPC 2.0，stdin/stdout，每行一个 JSON 对象）通信的程序。同一个插件可同时用于 Node CLI 与 Python SDK，使用任意语言编写。本页是面向 CLI 的简明路径；协议与信任模型的规范见 [Python SDK 设计文档](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/providers-and-credentials.md)，用户侧见 [提供商](providers.md)。

插件发布到 [alibaba-agent-sandbox/awesome-providers](https://github.com/alibaba-agent-sandbox/awesome-providers)，每个提供商一个目录。不要放进 SDK 或 CLI 仓库。该目录仓库还有贡献指南（`docs/authoring.md`）和给 AI 用的 skill（`SKILL.md`）。

## `abx create` 如何调用到 provider

`abx create` 不会 import 你的插件。它调用 `Sandbox.create`，这次调用在访问任何沙箱 API 之前先选定 provider。

```text
abx --provider my-cloud create --template base
        │
        │  1. main() 从参数里取出 --provider 和 --opt（任意位置）
        │     只在本次进程内保存。
        ▼
Sandbox.create({ template: "base", ... })
        │
        │  2. 决定 provider id，先匹配到的生效：
        │     显式 provider= 参数
        │     > --provider
        │     > ABX_PROVIDER
        │     > ./.env
        │     > ~/.abx/.env
        │     > ~/.abx/config.toml 的 [core] provider
        │     > alicloud-express
        ▼
   是 alicloud-express？ ── 是 ──► 内置阿里云客户端。你的插件不会启动。
        │
        否
        ▼
   3. 读取 ~/.abx/providers/my-cloud（清单 + 安装回执），校验目录摘要。
      不一致则是 E8011，进程不会启动。
        ▼
   4. 用裁剪过的环境变量启动 [runtime] command，工作目录是插件目录。
      stdin/stdout 上说 EPP/1。
        ▼
   5. initialize { protocol, host, provider_id, config, core, locale, data_dir }
      插件返回自己实现的 features。
        ▼
   6. sandbox.create { template, timeout, metadata, envs, cpu, memory, disk,
      gpu, request_timeout, secure?, options? }
        ▼
   7. SandboxRecord { sandbox_id, template, status, ... }。除非默认 provider
      和本次命令都是 alicloud-express，CLI 会把 id 打印成 my-cloud:<sandbox_id>。
```

之后的 `exec`、`upload`、`kill my-cloud:<id>` 都用这个 id。宿主先检查能力。没有声明 `exec.run` 时，`abx exec` 返回 E8004，不会发送 `exec.run`。

这两条路径**不会**进入你的插件：

- 没有 `--provider`、没有 `ABX_PROVIDER`、配置里也没有默认值时，`abx create` 仍走 `alicloud-express`。
- `abx create "一个 node 服务"`（有描述、没有 `--template`）会先走内置的模板编写流程（生成、构建、部署）。只有最后一次 `Sandbox.create` 使用选中的 provider。没有 `templates.build` 的 provider 用 `abx --provider my-cloud create --template <镜像或名称>` 来启动。

Python 里的 `Sandbox.create(template="base", provider="my-cloud")` 从第 2 步开始，不经过 CLI。它用的仍是已安装的 `~/.abx/providers/my-cloud`。

可运行的示例（复制其一即可）：

| 插件 | 类型 | 展示内容 | 源码 |
|---|---|---|---|
| `e2b-compatible` | `rest` | 仅清单：任意 E2B 协议端点，对通用 `sandbox_*` 键的 `inherit` 授权 | `python-sdk/examples/providers/e2b-compatible/` |
| `local-process` | `exec`，Python 标准库 | 生命周期、exec（缓冲与流式）、文件、一个密钥选项与一个布尔选项 | `python-sdk/examples/providers/local-process/` |
| `opensandbox` | `exec`，无依赖的 Node ESM | 完整的真实后端：生命周期、暂停/恢复、流式 exec、文件、端口 URL，以及单元/mock/live/契约测试 | [awesome-providers/opensandbox](https://github.com/alibaba-agent-sandbox/awesome-providers/tree/main/opensandbox) |

## 1. 清单

```toml
manifest_version = 1

[provider]
id      = "my-cloud"                   # ^[a-z][a-z0-9]*(-[a-z0-9]+)*$，不能是保留 id
name    = "My Cloud"
version = "0.1.0"

[compat]
protocol = "epp/1"
requires = { sdk = ">=0.3", cli = ">=0.3" }   # CLI 拒绝启动不兼容的插件（E8013）

[runtime]
kind    = "exec"
command = ["node", "./provider.mjs"]    # 以插件目录为工作目录运行
startup_timeout_ms = 10000
call_timeout_ms    = 60000

[features]
supported = ["sandbox.lifecycle", "exec.run", "exec.stream", "files.rw"]

[security]                               # 仅作提示：显示在同意界面，不强制执行
network          = ["api.my-cloud.example"]
filesystem       = ["data_dir"]
spawns_processes = false

[core]
inherit = []                             # 希望收到的通用键（sandbox_api_key 等）；用户必须同意

[config.fields.api_key]
type = "string"
secret = true                            # 存放在 ~/.abx/.env 的 ABX_MY_CLOUD_API_KEY，处处掩码
credential = true
required = true
description = "API key"

[config.fields.region]
type = "enum"
choices = ["eu-1", "us-1"]
default = "eu-1"
```

值得注意的规则：

- **配置只通过 `initialize` 到达插件。** 插件进程以最小环境启动，只会收到它声明的选项以及用户同意的 `[core] inherit` 中的通用键，别无其他。
- 只声明你真正实现的特性，并且要声明全。需要未声明特性的命令会在发出任何请求之前以 `E8004` 失败，因此缺失的方法永远不会表现为 `AttributeError` 或 404。`exec` 插件和 `rest` 预设都是如此（`rest` 清单没有声明 `files.rw` 时，所有文件调用都以 `E8004` 失败，不会访问网络）。`abx provider list` 会显示每个提供者声明的特性。
- 选项名为 `[a-z][a-z0-9_]*`。规范环境变量名按规则派生：`ABX_<PROVIDER_ID>_<KEY>`（短横线变下划线）。添加 `env = ["VENDOR_NAME"]` 即可同时接受后端的原生变量。
- `abx provider info my-cloud` 显示用户将看到的内容；开发时用 `abx provider install ./my-cloud --link --yes` 原地安装。

## 2. EPP/1 方法

CLI 通过 stdin/stdout 调用这些方法（权威列表见 `docs/design/fixtures/epp-methods.json`）：

| 分组 | 宿主实际发送的方法 |
|---|---|
| 握手 | `initialize`（传入配置，返回 `features`）、`shutdown` |
| `sandbox.lifecycle` | `sandbox.create`、`sandbox.get`、`sandbox.list`、`sandbox.kill`。`sandbox.connect` 可选：收到 `-32601` 时宿主改调 `sandbox.get` |
| `sandbox.timeout` / `sandbox.pause` | `sandbox.set_timeout`、`sandbox.pause`、`sandbox.resume` |
| `exec.run` / `exec.stream` | `exec.run`（缓冲）。流式是 `exec.start`，随后是 `exec.output` / `exec.exit` 通知 |
| `process.manage` | `process.list`、`process.kill`、`process.signal`、`process.stdin` |
| `files.rw` | `files.read`、`files.write`、`files.list`、`files.stat`、`files.mkdir`、`files.remove`、`files.move`。`files.search` 和 `files.chmod` 是扩展，宿主目前不会调用 |
| `ports.url` | `ports.url` |

`sandbox.create` 必须返回带 `sandbox_id` 的记录。有则一并返回：`template`、`status`、`metadata`、`envd_url`（或 `url`）、`envd_access_token`、`created_at`、`expires_at`、`region`。没有 `envd_url` 时，宿主继续通过 EPP 和你通信（`epp://<id>/<sandbox_id>`）。`envd_url` 是 `http(s)` 时，之后的文件、进程和终端走 E2B envd 传输，不再进入插件。

错误使用 JSON-RPC 错误码加 `data.sdk_code`。有三种结果要做对，因为脚本会按错误码匹配：

| 情形 | JSON-RPC | 用户看到的 |
|---|---|---|
| 提供者缺少某个特性 | `-32003`（特性未声明时宿主自己也会抛出） | `E8004`「Provider 'x' does not support 'feature'」 |
| `sandbox.get` / `connect` / `set_timeout` / `pause` / `resume` 指向不存在的沙箱 | `-32002`（可选 `data.sdk_code = "E2009"`） | `E2009`，退出码 4，与内置提供者的错误码一致 |
| 其他不存在的东西（模板、文件、进程） | `-32002` 加 `data.sdk_code`，例如 `E4001`、`E2001` | 对应的 SDK 错误；未给出时为 `E8005` |

对不存在的沙箱调用 `sandbox.kill` 不算错误（宿主视为已完成），所以插件可以返回成功，也可以返回 `-32002`。插件返回的沙箱 id 是裸 id；CLI 在打印时将其限定为 `my-cloud:<id>`。`ProcessInfo.pid` 可以是数字或字符串。

已经支持 E2B envd 数据面的后端只需实现控制面（create、connect、list、kill），并在结果中返回 envd URL：命令、文件与终端随后使用原生的快速传输。没有 envd 的后端则还需要实现 `exec.*` 与 `files.*`。

## 3. 开发与验证

```bash
abx provider install ./my-cloud --link --yes       # 原地安装，无完整性检查（仅用于开发）
abx provider doctor my-cloud                       # 清单、requires、配置完整性、握手
abx config set providers.my-cloud.api_key          # 掩码提示
abx provider test my-cloud -o region=eu-1          # 契约测试（18 个用例；不支持的特性会被跳过）
abx --provider my-cloud create --template base
```

`abx provider test` 运行参考插件通过的同一套契约套件：生命周期、exec、流式输出、文件、进程控制、超时、错误映射。要在不依赖 CLI 的情况下对插件做单元测试，可以直接用 NDJSON 驱动其进程的 stdin。

### 编写检查清单

1. `abx-provider.toml`：`manifest_version = 1`、合法的 id、`[compat] protocol = "epp/1"` 和 `requires`、`[runtime] kind = "exec"` 以及可在插件目录下运行的 `command`。`abx provider install ./dir --link --yes` 在清单有错时返回 `E8014`，信息里会指出出错的字段。
2. 必须实现的方法：`initialize`（返回你实现的特性）和 `shutdown`；然后为每个声明的特性实现对应的一组方法（见第 2 节的表）。`sandbox.connect`、`ports.url` 和 `files.*` 的扩展方法是可选的。
3. 特性开关：只声明确实可用的特性。宿主不会调用未声明特性的方法，而是自己返回 `E8004`。不要为了「以后会做」而提前声明。
4. 错误：明知缺少某特性时返回 `-32003`，沙箱不存在时返回 `-32002`，凡是有对应 SDK 错误类的都带上 `sdk_code`。不要把凭证写进错误信息；宿主会脱敏已声明的密钥，但不会脱敏你自己拷贝的副本。
5. 配置：每个选项都在 `[config.fields.*]` 下声明，密钥设置 `secret = true`。用 `env = [...]` 接受厂商自己的变量名，现有的 shell 配置就继续有效。不要自己读环境变量；宿主在 `initialize` 里传入配置。
6. 契约测试：`abx provider test my-cloud` 运行 18 个用例（声明的特性均已知、生命周期、kill 幂等、超时、exec 的退出码 / stderr / 环境变量 / 流式顺序 / 超时、进程列表、文件往返、二进制与 Unicode、目录操作、类型化的 not-found、端口、未声明特性返回 `E8004`、错误信息中密钥已脱敏）。未声明特性对应的用例会被跳过，不算失败。Python 里用 `python -m agent_sandbox.providers test my-cloud` 运行同一套用例。
7. 发布：用 40 位十六进制提交写出钉扎的安装说明，如实填写 `[security]`，README 里写明同意界面会显示的内容。

## 4. 发布并从 git 安装

1. 把 `abx-provider.toml` 放在仓库根目录，或放在一个子目录里。单元测试、夹具，以及任何不希望被计入摘要的文件，都不要放进这个目录。
2. 提交插件文件。标签和分支都不是钉扎。
3. 复制完整的 40 位十六进制 commit。用户把它作为 `--ref` 传入。

```bash
# 交互式：先打印同意界面，再复制文件树
abx provider install https://github.com/you/abx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7

# 插件在更大仓库的 providers/my-cloud 子目录里。
# // 是子目录，和 `abx template install owner/repo//subdir` 同一写法。
abx provider install you/plugins//providers/my-cloud \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7

# CI，没有 TTY：--yes 表示已阅读同意界面（不加则退出码 2 / E8012）
abx provider install https://github.com/you/abx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7 --yes
```

这条命令的行为：

- Git 只取对象，不检出工作树。安装器自己写文件。安装过程中不会运行插件里的任何程序。
- `--ref` 写成标签或分支（或不写 `--ref`）就是未钉扎。未钉扎的 ref 只有在有人于终端读过同意界面（不加 `--yes`）之后才会被接受，或者显式加 `--allow-unpinned`。单独的 `--yes` 永远不会接受会移动的 ref：它以 `E8012` 失败，并打印应当钉扎的提交（`--ref <40 位十六进制>`）。`abx provider update` 适用同一规则。
- 同意界面显示清单摘要（运行命令、特性、安全声明、配置字段、插件将收到的通用凭证）和树摘要。没有终端又没有 `--yes` 时，安装以 `E8012` 停止，重新运行的提示里会保留 `--subdir` 和提交。
- `--sha256 <树摘要>` 按树摘要钉扎，摘要不一致则安装失败。
- `--subdir` 必须是仓库内的相对路径。用它把大型测试套件留在安装范围之外：除 `data/` 外的每个文件都会进入树摘要，每次启动都会再校验一次（文件被改过则是 `E8011`）。
- 带内嵌凭证的 URL 会被拒绝。`file://`、`git://`、`http://` 需要 `--allow-insecure-transport`，只用于开发。
- 安装之后用 `abx provider doctor <id>` 检查清单、版本要求、配置和握手。移动已钉扎的安装用 `abx provider update <id> --ref <新的 40 位 commit>`。

请如实填写 `[security]` 块：这是用户了解插件可能触及什么的唯一摘要，CLI 不会对插件进程做沙箱隔离。面向用户的安装规则也写在[提供商](providers.md#安装查看移除)。

## 5. 模板配置

`[template]` 表**只用于模板创作**（`abx template init` / `deploy` 的 Dockerfile 和代码生成）。它不决定 `abx create --template X` 的含义：那个字符串会在 `sandbox.create` 里原样交给你的插件，由你来映射。OpenSandbox 把它当作容器镜像 URI（`python:3.12-slim`），并提供 `default_image` 和 `image_aliases` 选项来使用短名；它没有 `[template]` 表，使用通用配置。

可选的 `[template]` 表。没有这张表时，模板生成使用通用 Docker 配置（`FROM python:3.12-slim`、`CMD ["python3", "commands.py"]`、`WORKDIR /app`），并说明该提供者没有模板配置。它不会使用阿里云极速版 FC 镜像。OpenSandbox 保持通用配置；其 create `entrypoint` 在这一轮不改。

表存在时，下表里标为必填的字段都必须给出。缺字段或类型不对会报 `Invalid abx-provider.toml: [template] ...`，插件不会加载。

| 字段 | 是否必填 | 规则 |
|---|---|---|
| `base_image` | 是 | 非空字符串。Dockerfile 的 `FROM`。 |
| `entrypoint_replaceable` | 是 | 布尔值。`false` 表示生成器不写 `ENTRYPOINT`。 |
| `server_start` | 是 | `image_cmd` 或 `platform_start_cmd`。 |
| `cmd` | `image_cmd` 时必填 | 非空字符串数组。`server_start` 为 `platform_start_cmd` 时必须省略或为空。 |
| `start_cmd` | `platform_start_cmd` 时必填 | 非空字符串。`server_start` 为 `image_cmd` 时必须省略或为空。 |
| `ready_cmd` | 否 | 字符串，或省略。 |
| `arch` | 是 | 非空字符串，例如 `linux/amd64`。 |
| `workdir` | 是 | 非空字符串。Dockerfile 的 `WORKDIR`。 |
| `reserved_ports` | 否 | 1 到 65535 的整数数组。模板不得绑定的端口。没有则省略或写 `[]`。 |
| `registry` | 是 | 关于如何拉取镜像的非空说明。凭证留在提供者配置里，不写进这个字符串。 |

镜像命令配置（通用 Docker）：

```toml
[template]
base_image = "python:3.12-slim"
entrypoint_replaceable = true
server_start = "image_cmd"
cmd = ["python3", "commands.py"]
arch = "linux/amd64"
workdir = "/app"
reserved_ports = []
registry = "按镜像 URI 拉取；私有仓库认证留在提供者配置里"
```

平台启动配置（Dockerfile 不写 `CMD` 和 `ENTRYPOINT`；平台运行 `start_cmd`，并用 `ready_cmd` 探测）：

```toml
[template]
base_image = "registry.example/runtime/base:1"
entrypoint_replaceable = false
server_start = "platform_start_cmd"
start_cmd = "agent-sandbox-server serve --port 9000 --commands /opt/app/commands.py"
ready_cmd = "agent-sandbox-server healthcheck --port 9000"
arch = "linux/amd64"
workdir = "/opt/app"
reserved_ports = [5000]
registry = "按镜像 URI 拉取；私有仓库认证留在提供者配置里"
```

`commands.py` 仍然只导入 `agent_sandbox.server`，并在 `if __name__ == "__main__"` 下调用 `serve(port=9000)`。服务端包不读取这张表。

内置 `alicloud-express` 的配置是 CLI 里的常量，不是插件清单：`server_start = "platform_start_cmd"`，工作目录 `/home/user/app`，保留端口 `49983`、`5000`、`49999`，镜像来自与沙箱区域一致的 FC 仓库。插件若要那个镜像，在自己的 `base_image` 里写上。省略 `[template]` 的插件不会继承它。
