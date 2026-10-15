# 从零构建模板到沙箱使用：端到端指南

本指南带你完成一个自定义沙箱模板从编写到生产使用的完整工作流。

```mermaid
graph LR
    A[编写模板] --> B[本地验证]
    B --> C[推送部署]
    C --> D[创建沙箱]
    D --> E[执行任务]
    E --> F[清理资源]
```

---

## 前置条件

- Docker Desktop 已启动（用于本地构建镜像）
- Node.js 20+
- 安装 CLI：

```bash
npm install -g @agent-sandbox/cli
```

> **无需额外安装扩展**：本指南用到的 CLI 特性——从 `template.yaml` 读取默认值（YAML 解析）、解析 `.env` 文件、从 registry 安装模板、阿里云模板 API——均已内置于 `@agent-sandbox/cli`。

- 阿里云 AK/SK 配置在 `.env` 文件中：

```env
ALICLOUD_ACCESS_KEY_ID=your-access-key-id
ALICLOUD_ACCESS_KEY_SECRET=your-access-key-secret
ACR_NAMESPACE=your-acr-namespace
```

- ACR 命名空间已在阿里云 ACR 控制台创建（一次性操作）。在控制台中依次打开 **容器镜像服务 ACR → 命名空间 → 创建命名空间**，然后将该命名空间名用作 `ACR_NAMESPACE`（或 `--acr-namespace` 参数）。

> 认证详情参见 [认证配置](authentication.md)。

---

## 替代起点：从 registry 安装现成模板

如果不打算从零编写模板，可以直接用 `abx template install`从 GitHub 仓库安装现成模板。官方与社区模板的真源是 [awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates)——先用 `abx template search <query>` 在远程索引中发现模板，再用 `abx template install <name>` 按名安装（也支持完整的 `owner/repo[//subdir][@ref]` 引用）。

> **`install` 现在默认运行完整流水线。** `abx template install <ref> --acr-namespace <ns>` 会在一条命令内完成**下载 → 构建镜像 → 推送 ACR → 通过官方 CreateTemplate API 部署**。若只想把源码下载到本地缓存（`~/.abx/templates/`）而不构建、不部署，加上 `--download-only`，然后再执行 `abx template build` / `abx template deploy`。

> ⚠️ **成本与安全**：默认的 `install`（以及 `abx template deploy`）会向你的 ACR 镜像仓库推送镜像并在你的阿里云账号上调用官方 `CreateTemplate` API——这些操作可能产生费用。仅想查看源码时请用 `--download-only`。

### 安装选项

| 选项 | 说明 |
|------|------|
| `--acr-namespace` | 构建+部署步骤使用的 ACR 命名空间（环境变量 `ACR_NAMESPACE`，或在 `.env` 中设置） |
| `--cpu` | CPU 核数（默认：来自 `template.yaml` 或 2） |
| `--memory` | 内存 MB（默认：来自 `template.yaml` 或 2048） |
| `-y`, `--yes` | 跳过确认提示 |
| `--download-only` | 仅下载到本地缓存（跳过构建和部署） |
| `--dir PATH` | 将模板源码下载到自定义目录，而非默认的 `~/.abx/templates` |

### 引用语法

```text
owner/repo                # 整个仓库（默认分支）
owner/repo//subdir        # 仓库子目录
owner/repo@main           # 指定分支
owner/repo//subdir@v1.0   # 子目录 + 指定 tag/branch/commit sha
./my-template             # 本地目录
```

子目录用双斜杠 `//` 分隔，版本引用用 `@` 后缀（tag、分支或 commit sha 均可，通过 GitHub tarball API 拉取，无需仓库发布 Release）。私有仓库与更高限流额度：推荐 `abx config set github_token`（星号脱敏输入，一次性保存到 `~/.abx/.env`），而非单次 `--token <github-token>` 覆盖（可能泄漏到 shell history 或进程列表）。

### 仅下载：先检查源码

加上 `--download-only` 后，`install` 只把模板下载到本地缓存——不构建、也不部署：

```bash
$ abx template install alibaba-agent-sandbox/awesome-templates//python-hello --download-only
Fetching template from alibaba-agent-sandbox/awesome-templates...
Alias   python-hello
Source  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello
Cached  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello
Status  installed-locally
Template 'python-hello' installed to the local cache. Build and push the image with 'abx template build'.
```

模板源码被缓存到 `~/.abx/templates/{owner}/{repo}/{ref}/{name}/`（`ref` 未指定时为 `default`），可直接查看：

```bash
$ ls ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello/
Dockerfile      README.md       commands.py     template.yaml

$ cat ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/python-hello/template.yaml
name: python-hello
version: "1.0.0"
description: "A minimal Python hello world template for testing"
author: "alibaba-agent-sandbox"
tags:
  - python
  - hello-world
  - example

base: ubuntu:22.04

system_packages:
  - python3
  - python3-pip

capabilities:
  - shell
  - files
  - code
  - ports

ports:
  - 9000


env:
  LANG: C.UTF-8
```

再安装一个 node-web 模板：

```bash
$ abx template install alibaba-agent-sandbox/awesome-templates//node-web --download-only
Fetching template from alibaba-agent-sandbox/awesome-templates...
Alias   node-web
Source  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/node-web
Cached  ~/.abx/templates/alibaba-agent-sandbox/awesome-templates/default/node-web
Status  installed-locally
Template 'node-web' installed to the local cache. Build and push the image with 'abx template build'.
```

本地目录的用法完全一样：

```bash
$ abx template install ./my-template --download-only
Using local template from ./my-template...
Alias   my-template
Source  ./my-template
Cached  ~/.abx/templates/my-template
Status  installed-locally
Template 'my-template' installed to the local cache. Build and push the image with 'abx template build'.
```

### 默认：一次性下载、构建并部署

不带 `--download-only` 时，`install` 会跑完整流水线。它在构建+部署步骤需要一个 ACR 命名空间；若未提供（通过 `--acr-namespace`、`ACR_NAMESPACE` 或 `.env`），它会在构建前停下并明确告诉你如何修复：

```bash
$ abx template install ./my-template -y
Using local template from ./my-template...
Cannot build + deploy. Missing prerequisites:
  • Missing ACR namespace. Provide via:
  1. abx config set acr_namespace <ns>   (or re-run 'abx config init')
  2. --acr-namespace flag
  3. export ACR_NAMESPACE=<ns>
  4. ACR_NAMESPACE=<ns> in .env (CWD or ~/.abx/.env)

Run with --download-only to just download the template.
```

提供命名空间即可运行完整流程（等价于 `abx template deploy`）：

```bash
abx template install alibaba-agent-sandbox/awesome-templates//python-hello --acr-namespace my-ns
```

### `--download-only` 之后如何使用

- **部署到自己的平台账号**：对缓存目录执行 `abx template deploy <缓存路径>`（或 `abx template build` 分步构建推送），流程与下文第三步完全一致。
- **模板已在平台上部署过**：无需 install，直接用模板名创建沙箱即可（`abx create --template python-hello`）。
- **本地二次开发**：缓存目录就是普通模板源码，可复制出来修改后按本文完整流程走一遍。

---

## 第一步：编写模板

### 脚手架生成新模板（推荐）

最快的起步方式是内置脚手架。`abx template init` 会生成一个开箱即用的模板目录，你不再需要凭记忆手写 `template.yaml` / `Dockerfile` / `commands.py`。

省略 `DIRECTORY` 参数时，脚手架会在当前工作目录下新建 `./<name>` 子目录。`<name>` 按优先级解析：`--name` > 脚手架案例名（`-t` 的值） > `--from` 拉取到的模板名。

列出可用的脚手架案例：

```bash
$ abx template init --list
  python       Python 3.11 sandbox with shell, files, and code capabilities
  node         Node.js 20 sandbox with shell, files, and code capabilities
  minimal      Bare-minimum template with only template.yaml + Dockerfile
```

将 Python 模板脚手架生成到 `./my-template`：

```bash
$ abx template init -t python ./my-template
✅ Template 'my-template' created in ./my-template
Created files:
  Dockerfile
  README.md
  commands.py
  template.yaml

Next steps:
  abx template deploy ./my-template --acr-namespace <ns>
  abx template install ./my-template --acr-namespace <ns>
```

> 脚手架与凭证配置是两条独立命令：`abx template init`（本节）只写本地文件，`abx config init` 存储凭证，`abx create` 启动云端沙箱。不存在顶层 `abx init`。

### 适配已有源码的项目

目录里已经是一个应用（Flask、Express、一段脚本），还没有 `Dockerfile` / `template.yaml` 时，用 `--adopt`。Qwen Code 只看到一份副本；abx 把 `Dockerfile`、`commands.py`、`template.yaml`，以及在你还没有时生成的 `.dockerignore`，写回同一目录。

```bash
$ abx template init --adopt ./my-app --hint "监听 8080"
# 看过预览之后：
$ abx deploy ./my-app --acr-namespace my-ns
```

`--dry-run` 列出将要发送的全部文件，不调用模型。非交互终端必须带 `-y`。`.env`、密钥、以及内容看起来像密钥的文件不会进入副本，Agent 进程也不会继承云凭证。备份、`--force`、写入前会拒绝哪些结果，见 [编写模板 — 适配已有项目](authoring-templates.md#适配已有项目)。

`abx template init "描述"` 是另一条 生成路径：根据一句话**新建**目录。`--adopt` 补的是你已经有的项目。

### 理解生成的文件

脚手架生成的文件布局与你手写时一致：

```text
my-template/
├── template.yaml    # 模板定义（名称、能力、资源）
├── Dockerfile       # 容器构建文件
├── commands.py      # 服务端命令注册（可选）
└── README.md        # 说明文档
```

#### template.yaml

生成的 `template.yaml`（python 案例）：

```yaml
name: my-template
version: "1.0.0"
description: "Python sandbox template"

base: python:3.11-slim

capabilities:
  - shell
  - files
  - code

resources:
  cpu: 2
  memory: 2048
```

**关键字段说明**：

| 字段 | 说明 |
|------|------|
| `name` | 模板唯一标识，用于 `--template` 参数 |
| `base` | 基础 Docker 镜像（当存在 Dockerfile 时此字段仅作参考） |
| `capabilities` | 运行时能力声明：`shell`、`files`、`code`、`terminal`、`ports` |
| `resources.cpu` | CPU 核数（部署时可通过 CLI 参数覆盖） |
| `resources.memory` | 内存 MB（部署时可通过 CLI 参数覆盖） |

完整字段规范参见 [template.yaml 规范](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)。

#### Dockerfile

生成的 `Dockerfile`（python 案例）：

```dockerfile
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

# agent-sandbox-server 不在 PyPI 上。这一行安装钉死的 python-sdk 提交里的 server-sdk。
# ABX_SERVER_SDK_SOURCE 会在构建时改成本地 wheel。
RUN pip install --no-cache-dir "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/61c43e0be65a1f57aa09186d578e7b399e48429b.tar.gz#subdirectory=server-sdk"

WORKDIR /app
COPY commands.py .

EXPOSE 9000
CMD ["python3", "commands.py"]
```

> **服务端安装**：`agent-sandbox-server` 没有发布到 PyPI。PyPI 上名为 `agent-sandbox` 的项目是另一个包。Dockerfile 里已经有这一行，或任何其他 40 位十六进制的 `python-sdk` `server-sdk` 归档钉时，部署不会请求 PyPI。上面这一行从钉死的公开提交归档安装 `server-sdk`，普通 `docker build` 不需要 BuildKit，也不需要本地 wheel。需要用某个检出目录时设置 `ABX_SERVER_SDK_SOURCE` 指向 `server-sdk`，`abx template deploy` 会按 wheel 的真实文件名复制它。Dockerfile 里如果还留着 `COPY *.whl` 且没有 wheel，这次构建会先去掉该行，因为旧构建器拒绝空通配符。

### 具名命令（可选）

具名命令不在 `template.yaml` 中声明。在 `commands.py`（沙箱内运行的 `SandboxServer` 入口）中注册，再用 `abx run <sandbox-id> <command>` 调用（用 `abx sandbox command list <sandbox-id>` 列出）：

```python
from agent_sandbox.server.registry import registry

@registry.command("test")
def test(path: str = ".") -> str:
    ...
```

```bash
abx run <sandbox-id> test --arg path=tests/
```

更复杂的模板（含 `commands.py` 服务端命令注册）参见 [node-web 示例](https://github.com/alibaba-agent-sandbox/awesome-templates/tree/main/node-web)（模板真源仓库）。

---

## 第二步：本地验证

在部署前，先本地验证 Dockerfile 能否正常构建：

```bash
# 构建镜像（必须使用 linux/amd64 平台，FC 运行时为 x86_64）
docker build --platform linux/amd64 --provenance=false -t my-app:test ./my-template

# 快速冒烟测试
docker run --rm my-app:test python3 -c "print('OK')"
```

> **关于 `--provenance=false`**：Docker Buildx 默认会生成 attestation manifest，导致阿里云 FC 镜像优化失败（模板会卡在 `error` 状态）。上面的手动 `docker build` 里之所以要带它，是因为该命令绕过了 CLI。`abx template deploy` 只在 `docker buildx version` 成功时添加 `--provenance=false`，并且只在那时打印自动添加的提示。没有 buildx 插件时不加这个参数，也不打印那条提示（旧构建器不会附带 provenance）。设置 `DOCKER_BUILDKIT=0` 会强制使用旧构建器。

---

## 第三步：部署模板

### 一键部署（推荐）

```bash
# 确保 .env 中已配置 ACR_NAMESPACE
abx template deploy ./my-template

# 非交互。stdout 是一个 JSON 对象，模板 id 在 TemplateID 字段。
abx --json template deploy ./my-template -y
```

`deploy` 命令内部执行 5 个步骤：

1. **Docker build** — 本地构建镜像（platform `linux/amd64`，`provenance=false`）
2. **ACR login** — 自动使用 AK/SK 兑换临时 Token 并登录 ACR
3. **Docker push** — 推送镜像到 ACR 仓库
4. **CreateTemplate API** — 调用阿里云 FCSandbox 官方 API 创建模板
5. **Poll until READY** — 轮询模板状态直到构建完成

> ⚠️ **成本与安全**：`abx template deploy`（以及默认的 `abx template install`）会向你的 ACR 镜像仓库推送镜像并在你的阿里云账号上调用官方 `CreateTemplate` API——这些操作可能产生费用。仅部署你确实要运行的模板。

在构建步骤中，只有 `docker buildx version` 成功时 CLI 才会添加 `--provenance=false` 并打印提示。没有 buildx 时不加参数，也不打印提示（设置 `DOCKER_BUILDKIT=0` 会走这条路径）：

```
ℹ 已自动添加 --provenance=false（避免 FC 镜像优化失败；设置 DOCKER_BUILDKIT=0 可跳过）
```

### 自定义参数

```bash
abx template deploy ./my-template \
  --acr-namespace my-ns \
  --tag v1.0 \
  --cpu 4 \
  --memory 4096
```

常用选项：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--acr-namespace` | ACR 命名空间 | 从环境变量或 `.env` 读取 |
| `--tag` | 镜像标签 | `latest` |
| `--cpu` | CPU 核数 | 从 `template.yaml` 读取，fallback 2 |
| `--memory` | 内存 MB | 从 `template.yaml` 读取，fallback 2048 |
| `--disk-size` | 磁盘 MB | 平台默认 |
| `--timeout` | 构建超时秒数 | 600 |
| `-v, --verbose` | 显示完整 Docker 构建日志 | 关闭 |

### 验证部署

部署完成后，用 `--official-api` 列出模板可查看**真实名称与状态**（`ready` / `building` / `error`）。以下为真实运行输出（2026-09-28，cn-hangzhou，为聚焦重点已截断）：

```bash
$ abx template list --official-api
┏━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━┳━━━━━━━━┓
┃ TemplateID           ┃ Name                        ┃ Alias ┃ Status ┃
┡━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━╇━━━━━━━━┩
│ tpl00000000000000001 │ hermes-agent                │       │ ready  │
│ tpl00000000000000002 │ codex-agent                 │       │ ready  │
│ tpl00000000000000003 │ python-hello-prov           │       │ ready  │
│ tpl00000000000000004 │ python-hello-v2             │       │ error  │
│ tpl00000000000000005 │ e2e-python-hello            │       │ error  │
│ tpl00000000000000006 │ python-hello                │       │ ready  │
│ tpl00000000000000007 │ node-web                    │       │ ready  │
│ tpl00000000000000008 │ base                        │       │ ready  │
│ …（本次账号共 36 个模板，此处截断）
└──────────────────────┴─────────────────────────────┴───────┴────────┘
```

> **状态含义**：只有 `ready` 的模板才能成功创建沙箱。上表中 `python-hello-v2`、`e2e-python-hello` 等处于 `error` 状态的模板（通常由镜像构建/优化失败导致，参见[故障排查](#故障排查)）无法用于 `abx create`。

不带 `--official-api` 时走 E2B 兼容接口，仅返回模板 ID（无名称/状态）：

```bash
$ abx template list
┏━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━┳━━━━━━━━┓
┃ TemplateID           ┃ Alias ┃ Status ┃
┡━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━╇━━━━━━━━┩
│ tpl00000000000000001 │ N/A   │ N/A    │
│ tpl00000000000000009 │ N/A   │ N/A    │
│ …（共 36 个，此处截断）
└──────────────────────┴───────┴────────┘
```

查看单个模板详情：

```bash
$ abx template info <template-id> --official-api
```

### 参数默认值优先级

CLI 参数 > `template.yaml` 中的声明 > 硬编码默认值。详见 [CLI 参考](../reference/cli-reference.md)。

---

## 第四步：使用沙箱

### CLI 工作流（真实运行记录）

> **关于以下输出**：均为 **2026-09-28 在 cn-hangzhou 区域真实执行** `abx` 命令捕获，未做任何虚构。为聚焦关键结果，每条命令在 stderr 上**仅打印一次**的 capability 回退 WARNING（`base` 无本地缓存 `template.yaml` 时的预期行为）已省略。任务 167 起该警告是诊断通道上的单行 `WARNING:`，结果只走 stdout、不再与之混排，原先重复的时间戳日志行已消失。沙箱 ID `sbx-00000000-0000-4000-8000-000000000000` 为本次真实创建生成，格式为 `sbx-<UUID>`；下文命令中的 `<SANDBOX_ID>` 请替换为你自己的 ID。

**① 创建沙箱**

```bash
$ abx create --template base
ID           sbx-00000000-0000-4000-8000-000000000000
Status       running
Template     base
URL          https://49983-sbx-00000000-0000-4000-8000-000000000000.cn-hangzhou.e2b.fc.aliyuncs.com
EnvdVersion  0.5.2
Sandbox sbx-00000000-0000-4000-8000-000000000000 created successfully.
```

**② 查看沙箱信息**

```bash
$ abx info <SANDBOX_ID>
ID           sbx-00000000-0000-4000-8000-000000000000
Template     base
Status       running
Region       cn-hangzhou
Timeout      300s
URL          https://49983-sbx-00000000-0000-4000-8000-000000000000.cn-hangzhou.e2b.fc.aliyuncs.com
EnvdVersion  0.5.2
Started      2026-09-28 04:03:13.302944+00:00
Metadata     {'fcSessionDetails': '{"containerId":"c-6ab9e700-…","sessionIdleTimeoutInSeconds":300,"sessionStatus":"Active"}', 'fcSessionID': 'd60cf963-…', …}   # 已截断
```

**③ 执行 Shell 命令**

```bash
$ abx exec <SANDBOX_ID> 'echo "Hello from sandbox"'
Hello from sandbox

$ abx exec <SANDBOX_ID> 'node --version'
v20.20.2

$ abx exec <SANDBOX_ID> 'python3 -c "print(2+2)"'
4
```

**④ 查看目录**

```bash
$ abx exec <SANDBOX_ID> 'ls -la /home/user'
total 40
drwxr-xr-x 1 user user 4096 Jul 19 08:08 .
drwxr-xr-x 1 root root 4096 Jul  9 07:32 ..
-rw-r--r-- 1 user user  220 Mar  8  2026 .bash_logout
-rw-r--r-- 1 user user 3526 Mar  8  2026 .bashrc
drwxr-xr-x 3 user user 4096 Jul 19 08:08 .config
-rw-r--r-- 1 user user   40 Jul 19 08:08 .npmrc
-rw-r--r-- 1 user user  807 Mar  8  2026 .profile
drwxr-xr-x 2 user user 4096 Jul 16 13:58 log
drwxr-xr-x 2 user user 4096 Jul 16 13:58 workspace
```

**⑤ 写入并读取文件**

```bash
$ abx exec <SANDBOX_ID> 'sh -c "echo hello > /home/user/test.txt"'
# （无 stdout 输出，退出码 0）

$ abx exec <SANDBOX_ID> 'cat /home/user/test.txt'
hello
```

**⑥ 上传 / 下载文件**

```bash
$ echo "uploaded from local" > /tmp/abx_e2e_test.txt

$ abx upload <SANDBOX_ID> /tmp/abx_e2e_test.txt /home/user/uploaded.txt
Uploaded /tmp/abx_e2e_test.txt -> /home/user/uploaded.txt

$ abx download <SANDBOX_ID> /home/user/uploaded.txt /tmp/abx_e2e_download.txt
Downloaded /home/user/uploaded.txt -> /tmp/abx_e2e_download.txt

$ cat /tmp/abx_e2e_download.txt
uploaded from local
```

**⑦ 查看沙箱系统信息**

```bash
$ abx sandbox system info <SANDBOX_ID>
OS             Linux
Arch           x86_64
Hostname       c-6ab9e700-1550f19f-ec5ff9d3d0af
CPU_Count      2
Python         3.13.13
Disk_Total_GB  9.81
Disk_Free_GB   9.29
```

**⑧ 列出运行中的沙箱**

```bash
$ abx list
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━━━━━┓
┃ ID                                       ┃ Template ┃ Status  ┃ Region      ┃
┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━━━━━┩
│ sbx-00000000-0000-4000-8000-000000000000 │ base     │ running │ cn-hangzhou │
└──────────────────────────────────────────┴──────────┴─────────┴─────────────┘
```

> **提示**：沙箱刚创建后，服务端列表可能有短暂延迟（最终一致）。若 `abx list` 暂时为空，稍等片刻重试即可。

**⑨ 销毁沙箱并验证**

```bash
$ abx kill <SANDBOX_ID> -y
Sandbox sbx-00000000-0000-4000-8000-000000000000 killed.

$ abx info <SANDBOX_ID>          # 验证：已销毁，返回 404
[E5000] Resource not found (HTTP 404).
  Suggestion: Verify the sandbox ID, template ID, or endpoint URL.

$ abx list
No sandboxes found.
```

### 模板名称解析（真实失败案例）

`--template` 既可传模板**名称**也可传**ID**，但只有状态为 `ready` 且镜像可正常拉起的模板才能成功创建。下面是对 `python-hello` 执行创建时的真实输出——尽管 `abx template list --official-api` 中有一个 `ready` 的 `python-hello`，但本次创建在冷启动阶段被平台重置连接：

```bash
$ abx create --template python-hello
[E5003] Connection reset by remote: <StreamReset stream_id:1, error_code:2, remote_reset:True>
  Suggestion: The platform closed the connection before responding. This usually means the operation took too long (e.g., sandbox cold start). Try:
  1. Increase HTTP timeout: abx config set http_timeout 120
  2. Retry the command
  3. Disable HTTP/2: abx config set http2 false
```

在 `http_timeout=120`、`http2=false` 配置下多次重试仍持续失败，最终报请求超时：

```bash
$ abx create --template python-hello
[E3001] Request timed out: 
  Suggestion: The HTTP request timed out. Try:
  1. Increase HTTP timeout: abx config set http_timeout 120
  2. Or set env: export ABX_HTTP_TIMEOUT=120
  3. Check network connectivity
```

> **经验**：创建前先用 `abx template list --official-api` 确认目标模板为 `ready`；当存在多个同前缀名称（如 `python-hello` / `python-hello-v2` / `python-hello-prov`）时，建议直接用**模板 ID** 避免歧义。若 `ready` 模板仍超时，通常是镜像冷启动过慢，可提高 `http_timeout` 或重试（参见[故障排查](#故障排查)）。

### 在代码中使用沙箱

如需通过 Python 驱动沙箱（创建、执行命令、读写文件、Agent 工作流模式），请参阅 [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md)。

---

## 第五步：清理与迭代

### 销毁沙箱

```bash
# 销毁指定沙箱
abx kill <sandbox-id>

# 销毁所有运行中的沙箱
abx kill --all --yes
```

> ⚠️ **数据丢失警告**：`abx kill --all` 会销毁账号下**所有**运行中的沙箱，其内存/临时数据将永久丢失。不带 `--yes` 时 CLI 会先要求确认——只在确定没有沙箱需要保留的自动化场景下才加 `-y/--yes`。

### 更新模板

修改模板文件后重新部署即可（使用新 tag 避免缓存）：

```bash
# 编辑模板
vim ./my-template/Dockerfile

# 重新部署（使用新版本标签）
abx template deploy ./my-template --tag v1.1
```

### 删除模板

```bash
abx template delete <template-id>
```

---

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| 没有 Dockerfile | 目录还是应用源码，不是模板 | `abx template init --adopt .`，然后 `abx deploy` |
| Confirmation required before project files are sent | 非交互的 `--adopt` 没有带 `-y` | 加上 `-y`，或用 `--dry-run` 只看文件列表 |
| Docker build 失败 | Dockerfile 语法错误 / 网络问题 | 加 `-v` 查看详细日志 |
| ACR login 失败 | AK/SK 过期或权限不足 | 检查 `.env` 中的凭证配置 |
| 模板卡在 building 状态 | 平台侧镜像优化中 | 等待或 `abx template info <id> --official-api` 查看状态 |
| 模板进入 error 状态 | Docker attestation 未禁用 | 确保构建使用 `--provenance=false`（SDK 默认已处理） |
| `E3001` Request timed out | HTTP 超时过短 | `abx config set http_timeout 120` |
| StreamReset / `E5003` | 平台冷启动慢 | 重试，或 `abx config set http2 false` 禁用 HTTP/2 |
| 沙箱创建失败 | 模板镜像拉取错误 | 检查 ACR 镜像可访问性和权限 |
| 命令返回 500 | Shell 运算符未包裹 | SDK 已自动处理 `sh -c` 包裹，检查 envd 版本 |

更多排查方法参见 [故障排查](troubleshooting.md) 和 [错误码参考](../reference/error-codes.md)。

---

## 延伸阅读

- [模板编写指南](authoring-templates.md) — 完整模板开发教程
- [CLI 参考](../reference/cli-reference.md) — 完整命令速查
- [认证配置](authentication.md) — API Key / AK-SK 双认证模式
- [环境变量](environment-variables.md) — 沙箱环境变量注入与作用域
- [模板真源 awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates) — 官方与社区模板内容、索引与发布的唯一真源（`abx template search` / `abx template install`）

## 相关 SDK 文档

- [template.yaml 规范](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md) — 所有字段定义
- [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md) — Python SDK 完整用法
