# 使用模板

模板是预配置的沙箱环境定义，包含基础镜像、预装软件、显式工作流契约和自定义命令。

---

## 什么是模板

模板是一个包含 `template.yaml` 的目录，定义了沙箱的运行环境。模板可以：

- 指定基础 Docker 镜像和预装包
- 声明服务、服务及其精确操作
- 定义自定义命令
- 设置默认环境变量和资源规格

项目模板必须声明 `spec_version: 5` 和 `provides`。`start_cmd` 启动模板的全部服务，`ready_cmd` 检查就绪。旧字段 `capabilities`、`tested_on`、`providers` 会被拒绝，不存在隐式能力授权。

---

## 列出可用模板

用 `abx template search python` 搜索公共目录，用 `abx template list` 列出当前提供方已注册的模板。只下载源码可用 `abx template install <ref> --download-only`，源码缓存在 `~/.abx/templates/`。

---

## 安装模板

### 从 GitHub 安装

```bash
# 基础格式：owner/repo
abx template install owner/repo

# 指定版本标签
abx template install owner/repo@v1.0

# 指定子目录
abx template install owner/repo//path/to/template

# 使用别名
abx template install owner/repo --alias my-python

# 私有仓库 / 更高限流：一次性保存 token（星号脱敏输入）
abx config set github_token
abx template install owner/private-repo

# 单次命令的临时覆盖（可能泄漏到 shell history 或进程列表）
abx template install owner/private-repo --token ghp_xxx
```

GitHub 匿名下载限流为 60 次/小时，保存 token 后提升至 5000 次/小时。推荐使用 `abx config set github_token` 而非 `--token`——后者是单次临时覆盖，可能泄漏到 shell history 或进程列表。优先级：`--token` > `GITHUB_TOKEN` 环境变量 > `./.env` > 持久化的 `github_token`。未配置 token 且触发匿名限流时，交互式终端会提供引导式一次性配置（无需 `--token`）。

### 从本地目录安装

```bash
abx template install ./my-template --registry-type local
```

### 快捷方式

用 `abx template install` 安装：

```bash
abx template install owner/repo
```

---

## 按模板创建沙箱

```bash
abx create my-python
```

---

## 自然语言创建

生成应用前先完成提供方和模型配置。现有的交互入口是 `abx config init --llm`；自动化可使用文档中的 `ABX_LLM_API_KEY`、`ABX_LLM_BASE_URL`、`ABX_LLM_MODEL`，模型名称必须是自己服务中可用的值。平台密钥与模型密钥用途不同；认证和构建准备条件见[认证说明](authentication.md)与[编写模板](authoring-templates.md)。

设置足够长的随机应用令牌后，先从只用标准库的小命令开始：

```bash
abx config init --llm
export ABX_SERVER_TOKEN="<YOUR_APPLICATION_TOKEN>"
```

```bash
abx create --prompt "创建一个 Python 沙箱，提供 add 命令接收两个整数并返回相加结果"
```

新生成的应用需要独立的运行时应用令牌。创建前设置环境变量 `ABX_SERVER_TOKEN`，或通过已有 `-e ABX_SERVER_TOKEN=...` 传入。CLI 在调用模型前校验，启动应用时注入；令牌值不会写入生成文件或构建步骤。仅生成本地文件时不要求令牌。创建的 JSON 保留原字段，并返回 `TemplateID` 与 `Services`，方便精确清理和访问应用。

`abx create --prompt "<描述>"`（没有提供已存在模板的位置参数时）走生成路径：调用 Qwen Code 生成 Dockerfile、`commands.py`（`agent_sandbox.server` HTTP 服务入口）与 template.yaml，构建部署后用生成的模板创建沙箱。

非交互运行需要 `--yes`；接受 `--detach`，生成路径原本就会在创建后返回而不进入终端。用 `abx create --prompt "描述" --help` 查看生成路径的完整选项。

默认使用本地 Docker 和 ACR。Express 下没有 Docker 时，可显式选择已有的平台 steps 路径：

```bash
abx create --prompt "创建一个 Python 沙箱，提供 add 命令接收两个整数并返回相加结果" \
  --yes --detach --build steps --dir ./generated
```

这仍然调用真实模型，生成自包含的 `base.image` 与 `build.run`，提交模板并等待 **Ready** 后创建沙箱。本地源码不会作为 COPY 构建上下文上传。生成服务固定使用官方 PyPI 的 `agent-sandbox-server==0.4.0a6` alpha，它不是稳定版 SDK。应审阅生成文件并实测业务 API；模型可能生成无效或不符合需求的代码，校验失败会保留目录并停止创建。

对于生成的原生 steps，CLI 使用提供方已解析的基础镜像、运行用户和工作目录，安装服务包，并把最终本地源码字节写入构建步骤。模型只生成业务文件和已有 `build.run` 中的额外依赖安装命令，无需编码源码或重复提供方的准备字段。无效结果仍会保留目录并在部署前停止。

`abx template deploy --build steps` 仍返回 **submitted**；先用 `abx template info <id>` 确认 Ready，再创建沙箱。生成和部署需要模型配置、沙箱 API 配置及 AK/SK；steps 不要求 ACR 凭据。

小型加法示例不代表尚未解决的 [pandas/matplotlib 构建超时](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/131)已修复；大型依赖需要单独检查构建。

---

## 模板与运行时操作

`base`、`code-interpreter-v1` 是平台模板别名，与项目源码目录不同。运行能力由提供方的真实操作和模板服务声明决定；镜像安装 Python 不代表实现了代码解释器协议。

项目清单显式绑定应用服务及其所需操作。用 `abx sandbox capabilities <id>` 查询沙箱，用 `abx sandbox command list <id>` 列出具名应用命令。参见[编写模板](authoring-templates.md)和 SDK 的[模板 YAML 规范](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)。

---

## 自定义命令

模板可以定义自定义命令，用户通过 `abx sandbox command run` 调用：

```bash
abx sandbox command run sbx-xxxx dev --arg port=8080
```

---

## 下一步

- [编写模板](authoring-templates.md) — 创建自己的模板
- [CLI 教程](cli-tutorial.md) — CLI 完整使用教程

---

## 相关 SDK 文档

在 Python 中按模板创建沙箱（`Sandbox.create(template=...)`、`sandbox.run()`、`sandbox.list_commands()`）见 SDK 的 [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md)。`template.yaml` 字段参考见[模板 YAML 规范](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)。
