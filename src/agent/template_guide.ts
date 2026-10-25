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

/** The existing platform steps API has no uploaded local COPY context. */
function platformStepsRules(profile: TemplateProfile): string {
  return `### 3a. 本次发布模式：steps（必须完成，Dockerfile 不参与本次构建）
- 仍创建 Dockerfile 供审阅和以后本地构建，但本次 template.yaml 必须包含：
  base:
    image: ${profile.base_image}
  build:
    mode: steps
    steps:
      - {type: USER, args: [root]}
      - {type: RUN, args: [<完整安装依赖的 shell 命令>]}
      - {type: RUN, args: [<在绝对路径 ${profile.workdir}/commands.py 写入源码的完整 shell 命令>]}
      - {type: WORKDIR, args: [${profile.workdir}]}
      - {type: RUN, args: [<检查语法并修正工作目录所有权的 shell 命令>]}
      - {type: USER, args: [${profile.user || "root"}]}
- 以上 image 是提供方已解析的完整引用，必须逐字保留，不能改成 latest、其他 tag 或其他区域。
- 平台只收到 base.image 与这些类型化 steps，不会收到当前目录、Dockerfile 或 COPY 上下文。
  这条禁止 COPY 仅针对 build.steps；Dockerfile 仍必须遵循上一节 COPY commands.py 并保持完整。
  build.steps 不能使用 COPY、相对路径本地文件、或假定 commands.py 已存在。
- 必须在 RUN 步骤用 python3 -m pip install --index-url https://pypi.org/simple 安装 Python 依赖及 ${SERVER_SDK_RELEASE_SPEC}（alpha）；不要依赖基础镜像的默认镜像源缓存。
- 为避免 Python 源码、shell、YAML 三层缩进或转义损坏，不手写源码 heredoc 到 YAML。
  先完成 commands.py，再运行本地 Python 标准库 base64.b64encode(Path("commands.py").read_bytes()).decode()
  在同一个本地 Python 脚本中读取真实文件、编码、构造 manifest 并写入 JSON。
  不要把 base64 打印到会话后再复制进大型 write_file 调用；编码只在本地变量里传入单行 RUN：
  mkdir -p ${profile.workdir} && printf '%s' '<真实base64内容>' | base64 -d > ${profile.workdir}/commands.py
  每个业务文件都使用相同方式。不要手算 base64，不要留下占位符。
- 用 Python 字典构造完整清单，再用 json.dumps(manifest, ensure_ascii=False, indent=2) 写 template.yaml。
  JSON 是合法 YAML，CLI 接受此格式；每条 RUN 的 args 是只包含一个完整 shell 字符串的数组。
  可以运行本地 Python 处理文本，但不要安装依赖、运行 Docker 或执行云构建。
- 使用上面的 build.steps 顺序，不混用 build.run/apt_install/pip_install（快捷指令会在 USER root 前执行）。
  平台默认构建用户不一定是 root；安装阶段先 USER root，结束时恢复 provider 运行用户 ${profile.user || "root"}。
  先完成所有 WORKDIR 步骤，再在最后一个 RUN 中检查语法并执行
  chown -R ${profile.user || "root"}:${profile.user || "root"} ${profile.workdir}，然后 USER ${profile.user || "root"}；chown 后不要再放 WORKDIR。
${profile.provider_id === "alicloud-express" ? `  Express steps 实测：USER root 下的 WORKDIR 会把已 chown 的目标目录重设为 root 所有；目录内文件的所有权可保持不变。
  这不是 Dockerfile 或其他 provider 的通用权限规则。` : ""}
  README 区分构建配置与运行时验证：只说明预期的运行用户和目录，不得仅凭 chown 声称已保证或实测可写。
  提供以实际非 root 运行用户在 ${profile.workdir} 创建临时子目录、写入/读取/删除文件并清理的检查方法；
  明确应用命令成功不代表目录可写。检查失败时报告身份与目录权限，不改成 root 运行、不使用 chmod 777、也不静默改写用户清单。
- 所有路径使用绝对路径；安装的库必须是 start_cmd 使用的同一个 Python 能导入的。
  已有 python3/pip 时不要重新 apt 安装 Python；仅在用户需求确实包含系统依赖时安装对应系统包。
  不要假定基础镜像的 Python 版本。用户没有要求依赖版本时，不要猜测或复制历史旧版本 pin，
  让目标解释器上的 pip 解析兼容版本。numpy/pandas/matplotlib 这类有官方 wheel 的库使用
  python3 -m pip install --only-binary=:all: pandas matplotlib
  （仅安装需求用到的包），拒绝无匹配 wheel 而进入耗时源码编译；不要为这些 wheel 安装 gcc、python3-dev 或图像开发包。
  普通依赖沿用基础镜像或用户配置的 pip 索引，不硬编码镜像地址，不为整个依赖安装强制切换官方源。
  仅 agent-sandbox-server alpha 的单独安装命令必须使用上文 --index-url https://pypi.org/simple，
  避免镜像尚未同步 alpha。不要把 server 与 pandas/matplotlib 合并到同一条 pip install 中。
  README 说明依赖解析策略，验收时记录实际 Python 与依赖版本；用户指定版本不兼容时报告错误，不静默换版本。
- 保留上面的 provider start_cmd / ready_cmd，实际源码必须写入它们引用的位置。
- 最后一个 RUN 用 python3 -m py_compile ${profile.workdir}/commands.py 检查语法。
- README 明确本次使用平台 steps，无需本地 Docker/ACR，也明确安装的是 alpha SDK。
- 每次工具输出都必须检查错误；大段文件拆成短小写入，避免 max_tokens 截断。
  最后用本地 Python 检查四个根文件存在、ast.parse(commands.py)、json.loads(template.yaml)、
  每个 step.args 是字符串数组，且 Dockerfile 包含 COPY commands.py。
  生成清单脚本采用独立短 .py 文件运行，避免在 shell 双引号里嵌套整个 Python 字典。
  自检失败就在同一工作目录修复后再检查，不能在工具失败或缺文件时声称完成。`;
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
