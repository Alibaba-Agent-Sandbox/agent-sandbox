# 编写提供商

提供商插件是一个目录，包含 `ebx-provider.toml` 清单；对于 `exec` 类型，还包含一个使用 **EPP/1**（JSON-RPC 2.0，stdin/stdout，每行一个 JSON 对象）通信的程序。同一个插件可同时用于 Node CLI 与 Python SDK，使用任意语言编写。本页是面向 CLI 的简明路径；协议与信任模型的规范见 [Python SDK 设计文档](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/providers-and-credentials.md)，用户侧见 [提供商](providers.md)。

可运行的示例（复制其一即可）：

| `python-sdk/examples/providers/` 下的目录 | 类型 | 展示内容 |
|---|---|---|
| `e2b-compatible/` | `rest` | 仅清单：任意 E2B 协议端点，对通用 `sandbox_*` 键的 `inherit` 授权 |
| `local-process/` | `exec`，Python 标准库 | 生命周期、exec（缓冲与流式）、文件、一个密钥选项与一个布尔选项 |
| `opensandbox/` | `exec`，无依赖的 Node ESM | 完整的真实后端：生命周期、暂停/恢复、流式 exec、文件、端口 URL，以及单元/mock/live/契约测试 |

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
secret = true                            # 存放在 ~/.ebx/.env 的 EBX_MY_CLOUD_API_KEY，处处掩码
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
- 声明你实现的每一个特性。需要其他特性的命令会在发出任何请求之前以 `E8004` 失败，因此缺失的方法永远不会表现为 `AttributeError` 或 404。
- 选项名为 `[a-z][a-z0-9_]*`。规范环境变量名按规则派生：`EBX_<PROVIDER_ID>_<KEY>`（短横线变下划线）。添加 `env = ["VENDOR_NAME"]` 即可同时接受后端的原生变量。
- `ebx provider info my-cloud` 显示用户将看到的内容；开发时用 `ebx provider install ./my-cloud --link --yes` 原地安装。

## 2. EPP/1 方法

CLI 通过 stdin/stdout 调用这些方法（权威列表见 `docs/design/fixtures/epp-methods.json`）：

| 分组 | 方法 |
|---|---|
| 握手 | `initialize`（传入配置，返回 `features`）、`shutdown` |
| `sandbox.*` | `create`、`connect`、`list`、`info`、`kill`、`set_timeout`、`pause`、`resume` |
| `exec.*` | `run`（缓冲）与 `stream`（通知） |
| `process.*` | `list`、`kill`、`send_stdin`、`connect` |
| `files.*` | `read`、`write`、`list`、`stat`、`remove`、`mkdir`、`rename`、`exists` |
| `ports.*` | `url`（成为 `sandbox.network.resolve(port)`） |

错误使用 JSON-RPC 错误码加 `data.sdk_code`：`-32002` 映射到 `data.sdk_code` 所指名的 SDK 错误（例如 `E2001`），未给出时映射为 `E8005`（退出码 4）。插件返回的沙箱 id 是裸 id；CLI 在打印时将其限定为 `my-cloud:<id>`。`ProcessInfo.pid` 可以是数字或字符串。

已经支持 E2B envd 数据面的后端只需实现控制面（create、connect、list、kill），并在结果中返回 envd URL：命令、文件与终端随后使用原生的快速传输。没有 envd 的后端则还需要实现 `exec.*` 与 `files.*`。

## 3. 开发与验证

```bash
ebx provider install ./my-cloud --link --yes       # 原地安装，无完整性检查（仅用于开发）
ebx provider doctor my-cloud                       # 清单、requires、配置完整性、握手
ebx config set providers.my-cloud.api_key          # 掩码提示
ebx provider test my-cloud -o region=eu-1          # 契约测试（18 个用例；不支持的特性会被跳过）
ebx --provider my-cloud create --template base
```

`ebx provider test` 运行参考插件通过的同一套契约套件：生命周期、exec、流式输出、文件、进程控制、超时、错误映射。要在不依赖 CLI 的情况下对插件做单元测试，可以直接用 NDJSON 驱动其进程的 stdin。

## 4. 发布并从 git 安装

1. 把 `ebx-provider.toml` 放在仓库根目录，或放在一个子目录里。单元测试、夹具，以及任何不希望被计入摘要的文件，都不要放进这个目录。
2. 提交插件文件。标签和分支都不是钉扎。
3. 复制完整的 40 位十六进制 commit。用户把它作为 `--ref` 传入。

```bash
# 交互式：先打印同意界面，再复制文件树
ebx provider install https://github.com/you/ebx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7

# 插件在更大仓库的 providers/my-cloud 子目录里
ebx provider install https://github.com/you/plugins.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7 \
  --subdir providers/my-cloud

# CI，没有 TTY：--yes 表示已阅读同意界面（不加则退出码 2 / E8012）
ebx provider install https://github.com/you/ebx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7 --yes
```

这条命令的行为：

- Git 只取对象，不检出工作树。安装器自己写文件。安装过程中不会运行插件里的任何程序。
- `--ref` 写成标签或分支就是未钉扎。非交互安装未钉扎的 ref 需要 `--allow-unpinned`。
- `--sha256 <树摘要>` 按树摘要钉扎，摘要不一致则安装失败。
- `--subdir` 必须是仓库内的相对路径。用它把大型测试套件留在安装范围之外：除 `data/` 外的每个文件都会进入树摘要，每次启动都会再校验一次（文件被改过则是 `E8011`）。
- 带内嵌凭证的 URL 会被拒绝。`file://`、`git://`、`http://` 需要 `--allow-insecure-transport`，只用于开发。
- 安装之后用 `ebx provider doctor <id>` 检查清单、版本要求、配置和握手。移动已钉扎的安装用 `ebx provider update <id> --ref <新的 40 位 commit>`。

请如实填写 `[security]` 块：这是用户了解插件可能触及什么的唯一摘要，CLI 不会对插件进程做沙箱隔离。面向用户的安装规则也写在[提供商](providers.md#安装查看移除)。

## 5. 模板配置

可选的 `[template]` 表。没有这张表时，模板生成使用通用 Docker 配置（`FROM python:3.12-slim`、`CMD ["python3", "commands.py"]`、`WORKDIR /app`），并说明该提供者没有模板配置。它不会使用阿里云极速版 FC 镜像。OpenSandbox 保持通用配置；其 create `entrypoint` 在这一轮不改。

表存在时，下表里标为必填的字段都必须给出。缺字段或类型不对会报 `Invalid ebx-provider.toml: [template] ...`，插件不会加载。

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
start_cmd = "easy-sandbox-server serve --port 9000 --commands /opt/app/commands.py"
ready_cmd = "easy-sandbox-server healthcheck --port 9000"
arch = "linux/amd64"
workdir = "/opt/app"
reserved_ports = [5000]
registry = "按镜像 URI 拉取；私有仓库认证留在提供者配置里"
```

`commands.py` 仍然只导入 `easy_sandbox.server`，并在 `if __name__ == "__main__"` 下调用 `serve(port=9000)`。服务端包不读取这张表。

内置 `alicloud-express` 的配置是 CLI 里的常量，不是插件清单：`server_start = "platform_start_cmd"`，工作目录 `/home/user/app`，保留端口 `49983`、`5000`、`49999`，镜像来自与沙箱区域一致的 FC 仓库。插件若要那个镜像，在自己的 `base_image` 里写上。省略 `[template]` 的插件不会继承它。
