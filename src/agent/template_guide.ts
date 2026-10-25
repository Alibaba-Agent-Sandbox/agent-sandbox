/**
 * Reference material handed to the coding agent when it generates a template.
 *
 * The HTTP server (`agent_sandbox.server`, port 9000) does not depend on a sandbox provider. The Dockerfile base
 * image and start style come from the selected provider's template profile (`providers/template_profile.ts`): one
 * profile, one prompt. `commands.py` stays provider-free and calls `start()` only under `if __name__ == "__main__"`.
 */

import {
  dockerfileCmdLine,
  resolveTemplateProfile,
  type TemplateProfile,
} from "../providers/template_profile.js";

import type { BuildMode } from "../template/build_plan.js";
import { SERVER_SDK_RELEASE_SPEC } from "../utils/server_sdk_pin.js";

export const __all__ = [
  "REQUIRED_TEMPLATE_FILES",
  "buildTemplateGuide",
  "SERVER_ENTRYPOINT",
  "SERVER_PORT",
  "TEMPLATE_GUIDE",
  "REFERENCE_COMMANDS_PY",
] as const;

/** Files every generated template must contain. */
export const REQUIRED_TEMPLATE_FILES: readonly string[] = ["Dockerfile", "commands.py", "template.yaml"];

/** Container entry point the Dockerfile must start. */
export const SERVER_ENTRYPOINT = "commands.py";

/** Port `start()` listens on (`SandboxServer.serve` default). */
export const SERVER_PORT = 9000;

/** Minimal, complete `commands.py` shown to the agent as the shape to follow. */
export const REFERENCE_COMMANDS_PY = `"""<template-name> — sandbox command server."""
from __future__ import annotations

import os

from agent_sandbox.server import command, start


@command("hello", description="Say hello.")
def hello(name: str = "World") -> str:
    return f"Hello, {name}!"


# Bind the port only when run as main, so a platform --commands import does not serve.
if __name__ == "__main__":
    start(int(os.environ.get("ABX_SERVER_PORT", "${SERVER_PORT}")))
`;

const _FILES_CREATE = `### 2. 模板必须包含的文件
- \`Dockerfile\`
- \`commands.py\`：服务入口，见下文
- \`template.yaml\`
- \`README.md\`：模板是什么、需要哪些环境变量、调用示例（CLI 与 curl）
  CLI JSON 示例使用 \`abx --json sandbox command run <sandbox_id> <名字> --json-args '{"参数":"值"}'\`，
  该 JSON 模式返回 \`{"result": <返回值>}\`；省略 \`--json\` 时仅输出返回值。不存在 \`--input\`。先用 \`abx sandbox command list <sandbox_id>\` 查看实际命令。
  curl 使用用户从实际应用绑定取得的 \`APPLICATION_URL\`；不要手拼 sandbox 域名或猜测网关 URL。
  说明该绑定要求的网关认证（如 \`X-Access-Token\`）与可选应用 \`Authorization: Bearer\` 独立，
  必须按实际绑定传递相应凭据，不能把未认证的 URL 示例说成通用可用路径。
  本次 README 只提供上述 CLI/HTTP 调用与所需环境变量，不扩写默认权限策略，也不生成未经验证的 Python/Node SDK 示例；
  尤其不要把同步 \`Sandbox(template=...)\` 或进程 \`sandbox.commands.run\` 冒充应用命令 API。
需求确实需要时，可再添加业务代码（如 \`app.py\`、\`server.js\`、\`requirements.txt\`），
放在当前目录，并在 Dockerfile 里 COPY 进镜像。
`;

const _FILES_ADOPT = `### 2. 模板必须包含的文件（适配已有项目）
用户已经有一个可运行的项目。你只能在当前目录写下面三个文件，其余文件一律不要创建、修改或删除：
- \`Dockerfile\`
- \`commands.py\`：服务入口，见下文
- \`template.yaml\`
\`.dockerignore\` 由 abx 自动生成，你不要创建或修改它。
不要创建 \`README.md\`，也不要新增业务代码或依赖清单：需要的依赖直接在 Dockerfile 里安装。
项目自己的代码按原样保留，用**明确的路径**逐项 COPY（例如 \`COPY app/ ./app/\`），
不要用 \`COPY . .\`。如果项目里已经有 Dockerfile，请在它的基础上修改（保留它的依赖安装步骤），
基础镜像与启动方式以第 3 部分的 provider 配置为准。
`;

function selectedProfile(profile?: TemplateProfile | string | null): TemplateProfile {
  if (profile && typeof profile === "object") return profile;
  if (typeof profile === "string") return resolveTemplateProfile(profile);
  return resolveTemplateProfile();
}

function howItIsUsed(profile: TemplateProfile): string {
  const common = `本模板的业务命令通过 provider 返回的应用 HTTP(S) 绑定访问；URL 与网关认证由实际绑定决定，不能手拼。
应用命令与 envd 进程执行是不同协议。所以镜像里**必须有一个常驻的 HTTP 服务**，
仅有 Dockerfile 的模板部署后无法被使用。Agent Sandbox 的标准做法是：\`commands.py\`
用 \`agent_sandbox.server\`（纯标准库、零第三方依赖的 HTTP 服务）在 **${SERVER_PORT}** 端口对外服务。
\`commands.py\` 只从 \`agent_sandbox.server\` 导入，并在 \`if __name__ == "__main__"\` 里调用 \`start(${SERVER_PORT})\`。`;
  if (profile.server_start === "platform_start_cmd") {
    return `${common}
这个 provider 的基础镜像入口保持为 PID 1。平台执行 start_cmd 加载 \`commands.py\`，不要把 \`start()\` 写在导入时会执行的位置。`;
  }
  return `${common}
容器主进程是 \`python3 commands.py\`（镜像 \`CMD\`）。`;
}

function dockerfileRules(profile: TemplateProfile): string {
  const ports =
    profile.reserved_ports.length > 0
      ? `不要绑定保留端口 ${profile.reserved_ports.join("、")}。`
      : `没有平台保留端口。`;
  const entry = profile.entrypoint_replaceable
    ? `ENTRYPOINT 可以替换。`
    : `不要写 ENTRYPOINT 指令（基础镜像的入口不可替换）。`;
  const installIntro =
    "- 安装 agent-sandbox-server，固定使用下面已发布的 PyPI alpha 测试版（不是稳定版）。" +
    "设置 `ABX_SERVER_SDK_SOURCE` 时 `abx template deploy` 改用本地 wheel：";
  const secrets = "- 不要在镜像里写入任何密钥；需要的密钥在 template.yaml 的 `env` 里只列名字（空值或非敏感默认值）。";
  if (profile.server_start === "platform_start_cmd") {
    return `### 3. Dockerfile 规则（provider \`${profile.provider_id}\`）
- 以这一行开头：\`FROM ${profile.base_image}\`。
- ${entry}
- 不要写 CMD 指令。平台用 start_cmd / ready_cmd 启动服务，而不是镜像指令：
  - start_cmd: \`${profile.start_cmd}\`
  - ready_cmd: \`${profile.ready_cmd ?? ""}\`
- 架构 \`${profile.arch}\`。\`WORKDIR ${profile.workdir}\`。默认用户 \`${profile.user || "镜像默认"}\`${profile.user ? `，写 \`USER ${profile.user}\`` : "，不要写 USER"}。
- \`template.yaml\` 里写 \`user: ${profile.user || '""'}\` 和 \`workdir: ${profile.workdir}\`。这是沙箱执行时的默认用户和工作目录，和 Dockerfile 保持一致。
- ${ports}
- 仓库：${profile.registry}
${installIntro}
\`\`\`
RUN python3 -m pip install --index-url https://pypi.org/simple --no-cache-dir "${SERVER_SDK_RELEASE_SPEC}"
\`\`\`
- \`COPY commands.py .\`（以及业务代码），\`EXPOSE ${SERVER_PORT}\`（业务端口一并 EXPOSE）。
${secrets}`;
  }
  const cmd = dockerfileCmdLine(profile);
  return `### 3. Dockerfile 规则（provider \`${profile.provider_id}\`）
- 以这一行开头：\`FROM ${profile.base_image}\`。镜像里必须有 python3 和 pip（基础镜像不是 Python 时
  用 apt-get 安装 \`python3 python3-pip\`，pip 需加 \`--break-system-packages\`）。
- ${entry}
- 架构 \`${profile.arch}\`。\`WORKDIR ${profile.workdir}\`${profile.user ? `，\`USER ${profile.user}\`` : ""}，\`COPY commands.py .\`（以及业务代码），\`EXPOSE ${SERVER_PORT}\`（业务端口一并 EXPOSE），
- \`template.yaml\` 里写 \`user: ${profile.user || '""'}\` 和 \`workdir: ${profile.workdir}\`。这是沙箱执行时的默认用户和工作目录。
  最后 \`${cmd}\`。
- ${ports}
- 仓库：${profile.registry}
${installIntro}
\`\`\`
RUN python3 -m pip install --index-url https://pypi.org/simple --no-cache-dir "${SERVER_SDK_RELEASE_SPEC}"
\`\`\`
${secrets}`;
}

/** Native source-file transport is assembled by the CLI from final local bytes. */
function platformStepsRules(profile: TemplateProfile): string {
  return `### 3a. 本次发布模式：steps（必须完成，Dockerfile 不参与本次构建）
- 仍创建可审阅的 Dockerfile、commands.py、template.yaml 和 README.md。
- CLI 已解析基础镜像 ${profile.base_image}、运行用户 ${profile.user || "root"}、工作目录 ${profile.workdir}。
  CLI 会确定性生成 base.image、安装 ${SERVER_SDK_RELEASE_SPEC}、上传最终业务文件、修正所有权并恢复运行用户。
- template.yaml 中只需在已有 build.run 字符串数组列出额外依赖安装命令；没有额外依赖时省略 build。
  不要写 base、build.steps、base64、heredoc、逐行 echo 或任何源码传输命令，不要重复安装 agent-sandbox-server。
  build.run 只安装需求确实需要的依赖，不运行应用；CLI 会在部署时传输真实文件内容。
- 先完成 commands.py 及确实需要的业务代码、依赖清单。不要创建生成 manifest 的辅助脚本。
  template.yaml 用 JSON 格式写入（JSON 是合法 YAML），用本地 Python json.dumps 序列化，避免 YAML/shell 嵌套转义。
- 不假定基础镜像的 Python 版本。pandas/matplotlib 等有官方 wheel 的包使用 --only-binary=:all:，
  只安装需求用到的依赖；版本不兼容时报告错误，不静默改版本，不安装无关编译工具。
- 保留 provider start_cmd / ready_cmd，commands.py 只在 __main__ 下 start，不写 CMD 或 ENTRYPOINT。
- README 说明平台 steps 无需本地 Docker/ACR、使用 alpha SDK。运行身份和目录可写性必须通过实际运行检查，
  不凭构建步骤声明已验证可写；不要改成 root 运行或 chmod 777。
- 完成前用本地 Python ast.parse 检查 commands.py、json.loads 检查 template.yaml，检查四个根文件都存在。
  不要执行云构建或安装本地依赖。`;
}

/**
 * Return the template specification handed to the coding agent.
 *
 * `mode` is `"create"` (a template is written from a description: it ships a `README.md` and may add business code)
 * or `"adopt"` (an existing project is adapted: only the four reserved files are written and the project's own code
 * is never touched).
 *
 * `profile` is a resolved {@link TemplateProfile}, a provider id, or omitted to use the same provider `abx` already
 * selected (`--provider` / `ABX_PROVIDER` / default `alicloud-express`). The text describes that one profile.
 */
export function buildTemplateGuide(mode: string = "create", profile?: TemplateProfile | string | null, buildMode: BuildMode = "auto"): string {
  if (mode !== "create" && mode !== "adopt") {
    throw new Error(`Unknown template guide mode '${mode}'; expected 'create' or 'adopt'.`);
  }
  const selected = selectedProfile(profile);
  const filesSection = (mode === "adopt" ? _FILES_ADOPT : _FILES_CREATE).replace(/\n+$/, "");
  const notice = selected.missing_profile ? `${selected.notice}\n\n` : "";
  return `## Agent Sandbox 模板规范（必须遵守）

${notice}### 1. 沙箱怎么被使用
${howItIsUsed(selected)}

${filesSection}

${dockerfileRules(selected)}

${buildMode === "steps" ? platformStepsRules(selected) : ""}

### 4. commands.py 规则（\`agent_sandbox.server\` API）
\`\`\`python
from agent_sandbox.server import (
    CapabilityGroup, command, default_table, start,
)
\`\`\`
- 具名命令用模块级 \`@command("名字", description="…")\`，注册在默认 registry 上。
  通过 \`POST /commands/<名字>\` 调用，body 是扁平 JSON，返回 \`{"result": <返回值>}\`。
  参数类型从函数签名推断（int→integer，float→float，bool→boolean，其余 string；无默认值即必填）。
  返回值必须可 JSON 序列化；出错直接 \`raise\`（服务返回 500）。\`hidden=True\` 的命令可调用但不在
  \`GET /commands\` 里列出。不要自己创建 registry。命令装饰器只有 \`@command\`。
- \`table = default_table()\` 后，\`table.enable_group(CapabilityGroup.X)\` 打开可选组。参数是
  \`CapabilityGroup\`，不是字符串。能力组：CORE（常开）、COMMANDS（默认开）、
  FILE_OPS（文件上传/下载/列表/搜索/打包，默认开）、PROCESS（\`/shell\`、后台进程，默认开）、
  TERMINAL（PTY，默认开）、SYSTEM（系统信息、\`/env\`、\`/ports\`，默认开）、
  DEV_TOOLS（\`/code/run\`、git，**默认关闭**）、BROWSER（Playwright，**默认关闭**）、
  AGENTS（Agents API，**默认关闭**）。只打开需求用得到的可选组；enable_group 不会关闭其他默认组。
- 自定义 HTTP 路由：\`@table.route("GET"|"POST"|"DELETE", "/path/{param}", group=CapabilityGroup.COMMANDS)\`，
  处理函数接收 \`request\`，返回 \`ServerResponse.ok({...})\`。需求不是自定义 HTTP 时不要写。
- 内置接口总是存在：\`GET /health\`、\`GET /capabilities\`、\`GET /commands\`、\`POST /commands/<名字>\`。
- 鉴权：设置了环境变量 \`ABX_SERVER_TOKEN\` 时，应用请求使用 \`Authorization: Bearer <ABX_SERVER_TOKEN>\`（仅 \`/health\` 免应用鉴权，\`/capabilities\` 需要应用 token）。平台网关的 \`X-Access-Token\` 独立配置，不要混用两个 token；不要在代码里写死 token。
- 需求是一个 Web/API 服务时：在 \`start()\` 之前用 \`subprocess.Popen([...])\` 拉起业务进程并监听自己的端口
  （该端口写进 template.yaml 的 \`ports\` 与 Dockerfile 的 EXPOSE），或者做成 \`@command\`。
  ${SERVER_PORT} 端口必须由 \`start()\` 提供。
- 文件末尾只在 \`if __name__ == "__main__":\` 里调用 \`start(${SERVER_PORT})\`。
  导入 \`commands.py\` 时不要调用 \`start()\` 或 \`serve()\`。平台 \`--commands\` 会 import 这个文件。
- 只使用上面列出的 API，不要臆造 SDK 里不存在的类、函数或接口。

### 5. template.yaml 规则
必填：\`name\`（使用给定的模板名）、\`version: "1.0.0"\`、\`description\`（一句话中文，不超过 50 字）、
\`spec_version: 5\`、\`provides\`、\`ports\`、\`resources\`。
- \`provides.app\` 声明 HTTP 应用协议 \`agent-sandbox-server\`、版本 2、端口及 \`commands.list/commands.run\`。
- 用 \`start_cmd\` 启动模板中的所有服务，\`ready_cmd\` 检查它们就绪；不要定义 workflows 或启动类型。
- 普通镜像内 Python 或应用服务不代表统一解释器支持；不要写旧字段 \`capabilities\`、\`tested_on\` 或 \`providers\`。
- \`ports\`：至少包含 ${SERVER_PORT}，业务端口一并列出。
- \`resources.cpu\`：1-8 的整数；\`resources.memory\`：512-16384 的整数（MB）。
${selected.resource_notes ? `- ${selected.resource_notes}` : ""}
- \`env\`：环境变量的名字与非敏感默认值（如 \`LANG: C.UTF-8\`）；密钥类只列名字，值留空。
- 部署不会应用 \`server:\`。打开可选组用 \`enable_group\` 或 \`ABX_SERVER_ENABLED_GROUPS\`。
- 具名命令只在 commands.py 里用 \`@command\` 注册，不要写进 template.yaml；用户用
  \`abx sandbox command run <sandbox_id> <名字>\` 调用。
- \`tags\`、\`author\` 可省略。
${
  selected.server_start === "platform_start_cmd"
    ? `- 这个 provider 由平台启动服务。\`template.yaml\` 还要写 \`generation: 2\`、\`start_cmd: ${JSON.stringify(selected.start_cmd ?? "")}\`、\`ready_cmd: ${JSON.stringify(selected.ready_cmd ?? "")}\`。\`abx template deploy\` 在缺这些键且目录有 \`commands.py\` 时使用同一组默认值。generation 1 不能带 start_cmd。`
    : ""
}

### 6. 完整参考：commands.py 的最小形态
\`\`\`python
${REFERENCE_COMMANDS_PY}\`\`\`
`;
}

/** Guide used by `abx create --prompt "<description>"` for the provider selected at import time. */
export const TEMPLATE_GUIDE: string = buildTemplateGuide("create");
