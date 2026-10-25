# 编写模板

本文档介绍如何创建自定义 Agent Sandbox 模板，包括目录结构、改造已有项目以及通过 CLI 发布。

三种起步方式都只写本地文件，之后用 `abx deploy` 发布：

| 起点 | 命令 |
|------|------|
| 内置脚手架 | `abx template scaffold -t python ./my-template` |
| 一句话（Qwen Code 新建目录） | `abx template scaffold --prompt "一个 Python 数据分析环境"` |
| 已有源码的项目 | `abx template scaffold --adopt ./app` — 见 [适配已有项目](#适配已有项目) |

---

## 模板目录结构

一个完整的模板目录结构如下：

```text
my-template/
├── template.yaml      # 必须 — 模板定义
├── Dockerfile         # 可选 — 自定义 Docker 构建（优先于 template.yaml 中的构建步骤）
├── commands.py        # 可选 — 通过 @command 注册自定义命令
└── README.md          # 可选 — 模板说明
```

`template.yaml` 是唯一必需的文件。

用 `abx deploy` 发布。`--build auto`（默认）在目录里有 Dockerfile 时走本地构建。否则把 `base.image` 和 `build:`（`apt_install`、`pip_install`、`npm_install`、`env`、`run`、`steps`）作为平台构建步骤提交，不在本地跑 Docker，也不推 ACR。`--build dockerfile` 和 `--build steps` 强制选择其中一条。见 [模板构建模式](../design/template-build-modes.md)。

---

## template.yaml 基础示例

```yaml
name: my-python-template
version: "1.0.0"
spec_version: 5
description: "Python data analysis application"
provides:
  app:
    protocol: agent-sandbox-server
    version: 2
    port: 9000
    operations: [commands.list, commands.run]
generation: 2
start_cmd: agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py
ready_cmd: agent-sandbox-server healthcheck --port 9000
ports: [9000]
resources: {cpu: 2, memory: 2048}
env:
  PYTHONUNBUFFERED: "1"
```

---

## 模板启动声明与具名命令

上面的示例描述由 `commands.py` 实现的 Express 应用 HTTP 服务，还需要 Dockerfile 或自包含的平台构建步骤。项目模板要求spec v5 模板声明；旧字段 `capabilities`、`tested_on`、`providers` 会被拒绝，不存在默认能力授权。具名命令用 `@command` 在 `commands.py` 注册，不写在 YAML 中。只在 `if __name__ == "__main__"` 中调用 `start()`。

用 `abx sandbox command list <id>` 列出，用 `abx sandbox command run <id> <name> --arg k=v` 调用。应用鉴权与 envd 分离；服务要求 token 时配置 `ABX_SERVER_TOKEN`，客户端不会在未授权后去掉凭据重试。服务须确认当前身份的精确端点操作后，CLI 才发送命令参数。参见[模板 YAML 规范](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)。

`base` 可以是镜像字符串或 `{ image: ... }`。Express generation 2 由平台 `start_cmd` / `ready_cmd` 启动服务，保留基础镜像入口。部署按返回模板 ID 和显式别名缓存清单；缓存项目清单不代表云模板已经 Ready。

## Dockerfile 自定义

目录里有 `Dockerfile` 时，镜像就是这个文件。`template.yaml` 不安装软件包。额外的包写成下一节提供者配置上的 `RUN`。默认提供者是 `alicloud-express`：FC 基础镜像，不写 `CMD` 或 `ENTRYPOINT`，工作目录 `/home/user/app`。`FROM python:3.11-slim` 不是这张镜像。

## 提供者模板配置

镜像里的 HTTP 服务不依赖沙箱提供者。`commands.py` 只导入 `agent_sandbox.server`，并在 `if __name__ == "__main__"` 下调用 `start(port)`。导入时调用 `start()` 或 `serve()` 会打断平台的 `--commands` 导入。9000 是服务端自己的默认端口。

`FROM`、`ENTRYPOINT` 是否可替换、用 `CMD` 还是平台的 `start_cmd` / `ready_cmd`、架构、工作目录、保留端口和仓库说明，来自**当前所选提供者的模板配置**。`abx` 用与其他命令相同的方式解析提供者：`--provider`，然后 `ABX_PROVIDER`，然后配置里的默认值（`alicloud-express`）。模板指南、代码生成提示和 `abx template scaffold` 只描述这一份配置。

- `alicloud-express` 使用 `FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>`，不写 `CMD` 或 `ENTRYPOINT`，由平台 `start_cmd` / `ready_cmd` 启动服务。工作目录是 `/home/user/app`。端口 49983、5000、49999 属于该配置的保留端口。
- 其他提供者在 `abx-provider.toml` 没有 `[template]` 表时使用通用配置（`FROM python:3.12-slim`、`CMD ["python3", "commands.py"]`、`WORKDIR /app`）。缺少配置不是 FC 镜像；生成器会写出那个没有配置的 provider id。
- 镜像从官方 PyPI 安装 `agent-sandbox-server==0.4.0a3`。脚手架与自然语言生成共用这一运行时版本。仅在明确设置 `ABX_SERVER_SDK_SOURCE` 时构建并注入本地开发 wheel；普通构建使用公开发行包。

---

## 适配已有项目

`abx template scaffold --adopt` 用于**已经有应用代码、还没有沙箱模板文件**的目录。Qwen Code 读取该项目的一份副本，abx 再把模板文件写回同一目录。这一步不构建、不推送、不启动沙箱；写完后用 `abx deploy` 发布。

```bash
abx template scaffold --adopt . --hint "API 监听 8080"
abx template scaffold --adopt ./app --dry-run          # 只列出文件，不发送
abx template scaffold --adopt ./app --name my-api -y   # 非交互
abx deploy ./app --acr-namespace my-ns
```

`--hint` 用来补充代码里看不出来的信息（监听端口、旁路服务、私有约束）。`--name` 指定模板名，必须匹配 `^[a-z0-9][a-z0-9-]*$`。省略时，abx 用目录名做成 ASCII slug。无法做成 slug 的目录名（例如纯中文）需要显式 `--name`。

### 写回的文件

确认预览之后（或加上 `-y`），只会写入这些文件：

| 文件 | 何时写入 |
|------|----------|
| `Dockerfile` | 总是 |
| `commands.py` | `SandboxServer` HTTP 入口，端口 9000 |
| `template.yaml` | 名称、资源、端口、模板启动声明 |
| `.dockerignore` | 仅当项目里还没有这份文件 |

应用源码保持原样。Agent 在这份名单之外创建或修改的文件会被报告并丢弃。被替换的文件保留为 `*.abx-bak`；已有备份不会被覆盖（下一份是 `.abx-bak.1`）。

### 发给模型的内容

abx 把候选文件复制到临时目录（系统临时目录下的 `abx-adopt-…`，不会放在 `~/.abx`），并在发送前征求确认。Agent 只在这份副本里运行。

不会进入副本的内容：`.git`、`node_modules`、虚拟环境等大目录；`.env` 以及其他按文件名识别的密钥（私钥、`credentials*`、`kubeconfig` 等）；内容看起来像密钥的文件；符号链接；二进制文件；大于 1 MiB 的文件。超过 2 000 个文件或 20 MiB 时命令会停下，并提示把 `--adopt` 指到子目录。

`--dry-run` 打印这份文件列表然后删除副本。它不调用模型，也不写项目。非交互环境（CI、管道输入、`--json`）必须带 `-y`，否则命令会在复制之前停下。

Agent 进程不会继承云或镜像仓库凭证（`ALICLOUD_*`、`E2B_*`、`ACR_*`、`AWS_*`、`GITHUB_TOKEN`）。它会拿到 `abx config` 里的 Qwen Code Key。

这会把项目源码发给模型。`abx template scaffold --prompt "描述"` 只发送你输入的那句话。

### 写入前的检查

出现以下情况时，abx 拒绝结果、项目保持不变，并打印暂存目录路径：

- Dockerfile 没有 `FROM`，或 `commands.py` 没有启动 `agent_sandbox.server`
- `template.yaml` 的 `ports` 或 `EXPOSE` 里没有端口 9000
- `COPY` / `ADD` 指向缺失或被忽略的文件（`COPY *.whl` 仍然允许：只有 `ABX_SERVER_SDK_SOURCE` 或 PyPI 上的正式 wheel 存在时 `abx template deploy` 才会注入；否则会在 `docker build` 之前去掉这一行）
- 应用 `.dockerignore` 和 `Dockerfile.dockerignore` 之后，仍有按文件名识别的密钥会进入 Docker 构建上下文
- 忽略文件排除了 `*.whl`，导致 SDK wheel 无法注入

已有的 `.dockerignore` 如果没有排除 `.env`（包括用 `!` 重新包含的情况），会在调用模型之前失败，并给出要补上的行。已有的 `.dockerignore` 不会被改写。

### 目录里已经有这些文件

| 项目里已有 | 结果 |
|------------|------|
| `template.yaml` | 拒绝：这个目录已经是模板。执行 `abx deploy`，或加 `--force` 重新生成（原文件保留为 `template.yaml.abx-bak`） |
| 没有 `import agent_sandbox.server` 的 `commands.py` | 需要 `--force` |
| `Dockerfile`，或已是 Agent Sandbox 入口的 `commands.py` | 交互式预览可以替换。`-y`、`--json` 和 CI 没有预览，需要 `--force` |

`abx template scaffold --from <本地目录>` 要求该目录里已有 `template.yaml`。没有的源码树会被拒绝，错误信息指向 `--adopt`，避免把 `.env` 和 `.git` 整份当作模板源码复制走。

生成失败时项目不变，错误信息里带有暂存目录。看完之后删掉那个 `abx-adopt-…` 目录即可。

`--adopt` 不能与 `-t`、`--from`、`--list` 一起用。`--hint` 和 `--dry-run` 必须配合 `--adopt`。

---

## 发布模板

### 发布到 GitHub

将模板目录推送到 GitHub 仓库，其他用户即可通过以下命令安装：

```bash
abx template install your-org/your-template
```

### 本地安装

```bash
abx template install ./my-template --registry-type local
```

模板安装后保存在 `~/.abx/templates/` 目录下。

### 本地构建并注册模板（template deploy）

当你需要将自定义 Docker 镜像注册为沙箱模板时，使用 `template deploy` 子命令。它自动执行：本地 Docker 构建 → ACR 推送 → 调用 CreateTemplate API。

> **前置条件**：
> - Docker 守护进程已启动
> - 阿里云 AK/SK 凭证（配置在 `.env` 或环境变量中）
> - 官方阿里云模板 API 客户端（`@alicloud/fcsandbox20260509`）已内置于 `@agent-sandbox/cli`，无需额外安装

```bash
# 默认使用官方 CreateTemplate API
abx template deploy ./my-template \
  --acr-namespace my-ns --acr-repo my-template

# 指定资源参数
abx template deploy ./my-template \
  --acr-namespace my-ns --cpu 4 --memory 4096 --disk-size 10240 --internet-access

```

**模板 API**：

| API | 认证方式 | 依赖 |
|-----|----------|------|
| 官方 CreateTemplate API | AK/SK | `@alicloud/fcsandbox20260509`（已内置） |

> **Region 注意**：官方 API 使用的 region 来自 `abx config set region`（未设置时为 `cn-hangzhou`）。单次部署可通过 `template deploy`/`build`/`create`/`push`/`list`/`info`/`install`/`delete` 的命令级 `--region`/`-r` 选项覆盖。跨区域访问 ACR 可能需要配置 VPC 相关参数。

### 仅从镜像创建模板

如果镜像已经推送到 ACR，可以直接创建模板，不需要本地构建：

```bash
abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-template
```

---

## 下一步

- [使用模板](using-templates.md) — 安装和使用模板

---

## 相关 SDK 文档

`template.yaml` 契约与 Python 侧的编写指南位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)：

- [模板 YAML 规范](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md) — 所有字段精确定义
- [编写模板（SDK）](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/authoring-templates.md) — 字段参考、工作流声明、自定义命令、`@command`
- [模板系统](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/template-system.md) — 分级、名称解析、版本管理
- [声明式用法](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/declarative-usage.md) — `@sandbox` 装饰器

## Express steps：工作目录权限

Express steps 构建时，先执行 `WORKDIR /home/user/app`，再在最后一个 `RUN` 中
检查源码语法并执行 `chown -R user:user /home/user/app`，最后恢复 `USER user`。
在实测的 Express generation-2 基础镜像 v0.0.49 上，root 身份下位于 chown 之后的
WORKDIR 会将目录属主重新设为 root，而 `commands.py` 的用户所有权仍可保持不变。
这是 Express 平台 steps 的实测行为，不代表 Dockerfile 构建或其他 Provider 的规则。

生成的 README 应说明预期运行身份和目录；构建时修改所有权不等于运行时已验证可写。
等待模板 READY 后创建实例，使用默认非 root 用户检查。构建 CLI 并配置 Provider 凭据后，可运行本仓库的检查脚本：

```bash
node e2e/generated-workdir.mjs --sandbox-id YOUR_SANDBOX_ID
```

脚本创建临时子目录，执行文件写入、读取、删除并确认清理，不修改权限或提升身份。
应用命令成功是另一项检查。失败时查看实际用户和目录元数据，修正自己模板的步骤顺序
后重新部署；不要用 root 运行应用或 `chmod 777` 绕过问题。CLI 不会自动改写已有用户清单。
检查完成后用 `abx kill YOUR_SANDBOX_ID` 删除实例，测试模板需要另外删除。

CLI 0.4.13 更新了新生成模板的指导规则；已有生成模板需要显式调整上述步骤顺序。
复杂数值计算依赖的构建超时由 [#131](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/131) 单独跟踪。
