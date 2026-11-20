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
这个 provider 的基础镜像入口保持为 PID 1。实例创建后由业务代码/SDK/CLI显式执行服务命令加载 \`commands.py\`，不要把 \`start()\` 写在导入时会执行的位置。`;
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
    "需要使用本地源码时由作者显式准备 wheel 并在Dockerfile中安装：";
  const secrets = "- 不要在镜像或模板里写入运行秘密；README列出实例创建时需配置的环境变量及用途。";
  if (profile.server_start === "platform_start_cmd") {
    return `### 3. Dockerfile 规则（provider \`${profile.provider_id}\`）
- 以这一行开头：\`FROM ${profile.base_image}\`。
- ${entry}
- 不要覆盖基础镜像入口；实例创建后显式执行并检查以下服务命令：
  - 启动: \`${profile.start_cmd}\`
  - 就绪检查: \`${profile.ready_cmd ?? ""}\`
- 架构 \`${profile.arch}\`。\`WORKDIR ${profile.workdir}\`。默认用户 \`${profile.user || "镜像默认"}\`${profile.user ? `，写 \`USER ${profile.user}\`` : "，不要写 USER"}。
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
  return `### 3a. Provider原生steps
- 从 template.image 指定的已有镜像准备模板，buildConfig.steps 使用 Provider 的 USER/WORKDIR/ENV/RUN 步骤。
- 不与本地 Dockerfile/context 分支叠加；普通源码生成选择 Dockerfile。
- steps 不自动上传本机文件，也不承诺将模板快照导出为OCI镜像。
- 基础镜像 ${profile.base_image} 的软件和运行用户以镜像实际内容为准。
- 运行身份和目录可写性必须通过实际运行检查，不凭构建步骤声明已验证可写。
- 数值依赖优先 --only-binary=:all:，不安装无关编译工具；版本不兼容时报告错误。`;

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
  （该端口写进 Dockerfile 的 EXPOSE，并在README说明实例端口解析），或者做成 \`@command\`。
  ${SERVER_PORT} 端口必须由 \`start()\` 提供。
- 文件末尾只在 \`if __name__ == "__main__":\` 里调用 \`start(${SERVER_PORT})\`。
  导入 \`commands.py\` 时不要调用 \`start()\` 或 \`serve()\`。平台 \`--commands\` 会 import 这个文件。
- 只使用上面列出的 API，不要臆造 SDK 里不存在的类、函数或接口。

### 5. template.yaml 规则
必填：\`specVersion: 1\`、\`name\`（给定模板名），以及命名资源 \`sandbox.agent\`。
- \`sandbox.agent.provider: ${selected.provider_id}\`。
- \`sandbox.agent.template.buildConfig: { dockerfile: Dockerfile, context: . }\`；context可省略，默认Dockerfile目录。
- CPU与内存写在 \`sandbox.agent.template.cpu\` 和 \`memorySize\`，按Provider能力校验。
- \`template.region\`保留模板地域。镜像、用户与工作目录由Dockerfile声明。
- 该文件准备模板，不创建动态实例；不要添加instance、services、start/ready或application区块。
- 若配置template.startCommand/readyCommand，它们仅属于Provider原生模板准备阶段，不是实例创建后的启动钩子。
- 实例的环境变量、认证、挂载与应用启动由业务代码/SDK/CLI在创建后配置；不要把运行秘密固化到镜像或模板。
- Registry上架元数据和可选表单parameters属于registry.yaml，本地运行不依赖它。
- 端口由进程监听和Dockerfile EXPOSE说明；通过Provider解析实际实例端口地址。
- commands.py通过@command注册命令；README完整说明创建实例、启动服务、认证与清理。


### 6. 完整参考：commands.py 的最小形态
\`\`\`python
${REFERENCE_COMMANDS_PY}\`\`\`
`;
}

/** Guide used by `abx template init --prompt "<description>"` for the provider selected at import time. */
export const TEMPLATE_GUIDE: string = buildTemplateGuide("create");
