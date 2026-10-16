# 提供方模板部署

> 状态：设计，尚未实现。本文不修改 EPP/1、引擎、现有 18 个功能 id，也不修改任何提供方插件。这些改动需要先批准本文。
>
> English: [`../../design/provider-template-deploy.md`](../../design/provider-template-deploy.md)
>
> 2026-10-15 读过的代码：`agent-sandbox` `a20f497`，`awesome-providers` `873f033`。同一天抓取的上游页面在正文里引用。没有在这些树或页面里读到的内容标为未验证。

## 1. 安装表在说什么

“可直接安装/构建”“需要已有模板 id”“先推送镜像”这三句不在上述提交的本仓库或 `awesome-providers` 里，对公开 registry 站点的检索也没有返回使用这些字句的页面。CLI 里已有的页面是[安装之后能跑什么](../guide/providers.md)。它把 18 个功能 id 映射到命令。`alicloud-express` 看起来支持全部命令，是因为 `src/providers/builtin.ts` 把 `this.features` 设成完整的 `FEATURES`。四个目录插件都没有声明 `templates.read` 和 `templates.build`。

`abx template deploy` 在 Docker、ACR 或 `CreateTemplate` 之前调用 `requireTemplateFeature("templates.build")`（`src/cli/template_provider.ts`，部署回调在 `src/cli/commands/template.ts`）。目录提供方因此返回 `E8004`，不会走进极速版的仓库流程。[provider-wiring-plan.md](../../design/provider-wiring-plan.md) 里 2026-10-13 那条“模板命令忽略 `--provider`，失败信息是 ACR credentials missing”在当前 `main` 上已经过时。

新功能落地之后，表应该这样显示：

| 提供方声明了 `template.deploy` | `sandbox.create` 已经接受的值 | 标签 |
|---|---|---|
| 是 | deploy 返回的 id 或引用 | 可直接构建 |
| 否 | 该后端上已经存在的 id | 需要已有模板 id |
| 否 | 容器镜像 URI | 先推送镜像 |

极速版今天落在第一行，是因为 CLI 而不是极速版 API 在构建镜像、推送、注册模板并等到 READY。平台调用仍然只收模板 id。

应该共用这条路径的调用方：

- `abx template deploy <dir>` 和 `abx deploy <dir>`（`src/cli/commands/template.ts`、`src/cli/commands/deploy.ts`）。
- Python SDK 不部署。它的指南让调用方去跑 CLI（`python-sdk` 的 `docs/en/guide/authoring-templates.md`）。以后 SDK 的部署走第 5 节的引擎路由，不另写一条流水线。
- `awesome-templates/scripts/express_e2e.py` 调 `abx template deploy`，再 `abx create` / `abx run`。它会清掉 `ABX_PROVIDER`，并且只打极速版。某个提供方实现了 `template.deploy` 之后，这个脚本可以带上 `--provider`，冒烟步骤保持不变。

## 2. 七个步骤，以及谁负责

| 步骤 | 今天做什么 | 本设计之后 |
|---|---|---|
| 1. 解析构建计划 | `src/template/build_plan.ts` 的 `resolveBuildPlan` 读 `template.yaml` 和 Dockerfile。`auto` 优先 Dockerfile。`steps` 把 `build:` 展开成 `{type, args}`。 | CLI。提供方不解析 `template.yaml`。 |
| 2. 构建镜像 | `_buildImage` 里本地 `docker build`，含 server-sdk wheel 或归档钉。极速版 `steps` 模式跳过 Docker，把步骤交给 `CreateTemplate`。 | `build: local` 归 CLI。`build: remote` 归提供方（E2B 在服务端跑步骤）。 |
| 3. 推到提供方拉得到的仓库 | `_pushImage` 推到 ACR（默认 `registry.cn-hangzhou.aliyuncs.com`）。 | 提供方声明 `push: registry` 并给出仓库名时，用 CLI 的推送助手。提供方远程构建，或镜像已经是提供方能拉的公开引用时，跳过。 |
| 4. 注册或创建模板 | `src/api/fc_template.ts` 的 `fc_template.createOfficialTemplate`，官方 FCSandbox `CreateTemplate`。 | 提供方方法 `template.deploy`。 |
| 5. 等到 READY | 同一模块的 `waitForTemplateReady`。步骤模式返回 `submitted`，不等待。 | 提供方。它发出进度，只在 `status` 终态或 `submitted` 时返回。 |
| 6. 返回 id 或引用 | `TemplateID`。`_rememberTemplate` 把 `template.yaml` 缓存在该 id、别名和 yaml 名称下。 | 提供方结果里的 `template_id`（`sandbox.create` 接受的字符串）以及可选的 `ref`。缓存仍由 CLI 做。 |
| 7. 删除、列出、查看 | `fc_template.ts` 里的极速版 list/get/delete，由 `templates.read` / `templates.build` 把关。 | 提供方方法 `template.list`、`template.get`、`template.delete`。 |

`abx-provider.toml` 里的 `[template]` 是编写期画像（`src/providers/template_profile.ts`：基础镜像、`server_start`、Dockerfile 的 `CMD`）。它不是 `abx create --template` 的运行时含义。OpenSandbox 没有 `[template]` 表，用的是通用画像（`FROM python:3.12-slim`，`CMD ["python3", "commands.py"]`）。

## 3. 各提供方

### 3.1 `alicloud-express`（内置）

原生模板：`CreateTemplate` 产生的极速版模板 id。API 接收镜像引用（步骤模式还有 `sandboxConfig.steps`）、CPU、内存、磁盘、generation、`startCommand`、`readyCommand`。它不接收本地目录。start 和 ready 命令需要 generation 2。同名的 generation 1 模板不能就地改成 generation 2（`fc_template.ts` 里的 `GEN1_START_COMMAND`）。

这个平台没有 `CMD` 或 `ENTRYPOINT`。画像的 `server_start` 是 `platform_start_cmd`。目录里有 `commands.py` 且没有显式 generation 时，`resolveDeployRuntime` 按 generation 2 发布，并带上：

- start：`agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py`
- ready：`agent-sandbox-server healthcheck --port 9000`

| `template.yaml` 字段 | 极速版 |
|---|---|
| `base` / `base.image` | Dockerfile 的 `FROM`，或步骤模式的镜像。占位符 `<region>`、`<tag>` 会换成 FC 基础镜像。 |
| `generation` | 会发送。画像负责启动服务且存在 `commands.py` 时默认 2，否则 1。 |
| `start_cmd`、`ready_cmd` | generation 2 时发送。 |
| `resources.cpu`、`resources.memory` | 会发送。文件没写时 CLI 默认 2 CPU、2048 MB。 |
| `ports` | 不传给 `CreateTemplate`。留在缓存的 `template.yaml` 里供能力查找。 |
| `env` | 这条路径上不是 `CreateTemplate` 的字段。 |

凭证：`ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET`（也是 ACR 用户名和密码的默认值）、`ACR_NAMESPACE`、`ALIBABA_CLOUD_REGION_ID`，再加上创建和运行用的 `E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`。插件不读 `E2B_*`。

已验证：`template.ts` / `fc_template.ts` / `build_plan.ts` 里的流水线，以及功能门闩。这个 CLI 的极速版真实部署记录在更早的改动里；本设计没有新跑一次。

### 3.2 `e2b`

插件：`awesome-providers/e2b/provider.mjs`。`buildInfra` 用宿主的 E2B 协议类打 `https://api.e2b.app`，请求头是 `X-API-Key`。创建是带 `templateID` 的 `POST /sandboxes`。清单没有声明模板功能，所以 deploy 是 `E8004`。README：单元测试打本机假 API；这台环境没有 `ABX_E2B_API_KEY`，没有做真实创建。

原生模板：E2B 模板 id（和别名），`Sandbox.create(template=...)` 把它当作 `templateID`。构建完成是一份快照：`startCmd` 在构建期间运行，`readyCmd` 必须退出码 0，快照里包含正在运行的进程。之后的 `create` 不会重跑 start 命令（[Start & ready commands](https://docs.e2b.dev/template/start-ready-command)）。

V1“直接提交 Dockerfile”的 API 已经停用。[V1 build system deprecation](https://docs.e2b.dev/migration/v1-build-deprecation) 写明 V1 构建在 2026-08-01 停止，`e2b template build` 只是一个立即退出的存根。公开 OpenAPI 把带 `dockerfile` 字符串的 `POST /templates` 和 `POST /v2/templates` 都标成 deprecated。当前的构建是：

1. `POST /v2/templates`，字段 `alias`、`cpuCount`、`memoryMB`。响应 `202` 带 `templateID` 和 `buildID`（[Create template (v2)](https://docs.e2b.dev/api-reference/templates/create-template-v2)）。
2. `POST /v2/templates/{templateID}/builds/{buildID}`，`fromImage` 与 `fromTemplate` 恰好给一个，加上 `steps`、`startCmd`、`readyCmd`，以及可选的 `fromImageRegistry`（`aws`、`gcp` 或 `registry`）（[Start build (v2)](https://docs.e2b.dev/api-reference/templates/start-build-v2)）。
3. `GET /templates/{templateID}/builds/{buildID}/status`。状态包括 `building`、`waiting`、`ready`、`error`、`uploaded`（[Get build status](https://docs.e2b.dev/api-reference/templates/get-build-status)）。

Dockerfile 由客户端的 `Template.fromDockerfile` 解析成这些步骤。支持的指令：`FROM`、`RUN`、`COPY`、`ADD`、`WORKDIR`、`USER`、`ENV`、`ARG`、`CMD`、`ENTRYPOINT`。`EXPOSE` 和 `VOLUME` 会被跳过（[Base image](https://e2b.dev/docs/template/base-image)）。另一条路是 `fromImage`：本地构建、推送，再把标签和仓库凭证传上去。步骤在 E2B 的服务器上执行。公开基础镜像的步骤构建不需要本地 Docker。

| 字段 | E2B |
|---|---|
| `base` | `fromImage`，或解析后的 Dockerfile 的 `FROM`。 |
| `generation` | 没有这个字段。不支持。 |
| `start_cmd`、`ready_cmd` | `startCmd`、`readyCmd`。它们在构建时运行，然后进程被做成快照。 |
| `cpu`、`memory` | 创建模板时的 `cpuCount`、`memoryMB`。 |
| `ports` | `EXPOSE` 被跳过。构建请求里没有端口。 |
| `env` | `ENV` 变成一个步骤。创建时传入的环境变量对 `startCmd` 不可见，因为那个进程已经跑过了。 |
| `build.steps` / `build.run` | CLI 已经产出 `{type, args}` 步骤。提供方把 `RUN`/`ENV` 映射到 E2B 的 `TemplateStep`。具体步骤 JSON 没有抄进本文；实现时对照当时的 OpenAPI。 |

凭证：公开基础镜像只需要 `ABX_E2B_API_KEY`。私有 `fromImage` 还要在 `fromImageRegistry` 里带仓库凭证。插件不读 `E2B_API_KEY`，也不读 `E2B_API_KEY`。

已验证：插件源码、清单，以及上面链接的 E2B 文档。未验证：一次真实构建、`TemplateStep` 的模式，以及 `COPY`/`ADD` 如何上传文件字节（start-build 页面有 `steps`，没有文件上传的请求体）。

### 3.3 `cubesandbox`

插件：`awesome-providers/cubesandbox/provider.mjs`。它说的是 E2B 形状的 CubeAPI（带模板 id 的 `POST /sandboxes`），另加 Cube 自己的 resume、端口，以及 49999 上的 Jupyter。清单没有模板功能。README：用集群里真实存在的模板 id，不要假设有 `base`。单元测试打假 API。没有做真实创建（3000 端口上没有服务）。

原生模板：服务端生成的 id（`tpl-` 前缀）。CubeAPI 的 `POST /templates` 接受 `CreateTemplateRequest`，返回 `202`，带 `jobID`、`templateID`、`status`、`phase`、`progress`（CubeSandbox `openapi.yml`，`operationId: create_template`）。必填字段是 `image`。还有：`name`、`alias`、`cpu`（毫核）、`memory`（MiB）、`command`、`args`、`env`（`KEY=VALUE` 字符串）、`exposedPorts`、`probePort`、`probePath`（设了探测端口时默认 `/health`）、`registryUsername`、`registryPassword`、`writableLayerSize`、`allowInternetAccess`。请求里的 `templateID` 会被忽略。状态走 `GET /templates/{templateID}/builds/{buildID}/status`。

`cubemastercli tpl create-from-image` 是文档里的操作路径（[Creating Templates from OCI Images](https://cubesandbox.com/guide/tutorials/template-from-image)）。镜像必须能被 CubeMaster 节点拉到。公开仓库不需要凭证。私有仓库需要 `--registry-username` 和 `--registry-password`。纯 HTTP 仓库的镜像引用要加 `http://` 前缀。单节点集群可以用本地镜像名，不必推送（[Local and Remote Image Template Practice](https://cubesandbox.com/guide/tutorials/template-build-practice)）。`--enable-inject-envd` 在 CLI 的 multipart 请求里上传 `envd` 二进制（[Custom Template Images](https://cubesandbox.com/guide/tutorials/bring-your-own-image)）。这里读到的 `CreateTemplateRequest` 没有这个字段。

| 字段 | CubeSandbox |
|---|---|
| `base` | 不是模板基础镜像。推上去的镜像就是 `image`。 |
| `generation` | 不支持。 |
| `start_cmd` | `command` 加 `args`（覆盖入口），不是极速版那种平台 start 命令。 |
| `ready_cmd` | `probePort` 和 `probePath`。没有 shell ready 命令字段。 |
| `cpu`、`memory` | `cpu` 用毫核（`2` 核 → `2000`），`memory` 用 MiB。 |
| `ports` | `exposedPorts`。探测端口应该是其中之一。 |
| `env` | `env`，格式 `KEY=VALUE`。 |

凭证：`ABX_CUBESANDBOX_BASE_URL`（默认 `http://127.0.0.1:3000`）、可选的 `ABX_CUBESANDBOX_API_KEY`、`ABX_CUBESANDBOX_DOMAIN`、`ABX_CUBESANDBOX_PROXY`。仓库用户名和密码是请求字段，今天的清单里没有。实现时加成配置字段，跟 OpenSandbox 已有的 `registry_username` / `registry_password` 一样。

已验证：插件、清单、README，以及 OpenAPI 和那三篇教程。未验证：对真实 Cube 集群的一次任务，以及 `POST /templates` 能不能注入 `envd`，还是只有 `cubemastercli` 可以。

### 3.4 `alicloud-container`

插件：`awesome-providers/alicloud-container/provider.mjs`。这是 ACS/ACK 的 sandbox-manager，说 E2B 形状的 HTTP，不是极速版。`native` 的 API 是 `https://api.{domain}`；`private` 是 `https://{domain}/kruise/api`。创建是带模板 id 的 `POST /sandboxes`。提供方 README 里的例子是 `code-interpreter`。清单没有模板功能。单元测试用假 API。这台环境没有 ACS/ACK 集群，没有做真实创建。

原生模板：一个 `SandboxSet`（`agents.kruise.io/v1alpha1`）的名字。`ack-sandbox-manager` 监视这个对象，并把它的名字暴露成 E2B 模板 id。镜像是 `SandboxSet` Pod 模板里的字段，例如 `registry-<region>-vpc.ack.aliyuncs.com/acs/code-interpreter:v1.6`（[Create an Agent Sandbox in an ACS cluster](https://www.alibabacloud.com/help/en/cs/user-guide/create-an-agent-sandbox)）。单次创建换镜像用的是 `Sandbox.create` 上的元数据 `e2b.agents.kruise.io/image`，仍然需要一个已有的模板名。组件变更说明里写了它支持模板的 `list` 和 `get`。这个插件没有打那些路由。

这个插件所讲的 E2B 兼容 HTTP 里没有 `CreateTemplate`。注册一个新模板意味着向集群提交 `SandboxSet`。那是 Kubernetes 写操作，插件没有这类凭证。

| 字段 | 容器版 |
|---|---|
| `base` | 操作者提交的 `SandboxSet` 里的容器 `image`，或创建时的元数据镜像覆盖。 |
| `generation`、`start_cmd`、`ready_cmd` | `POST /sandboxes` 上没有这些字段。Pod 命令写在 `SandboxSet` 里。 |
| `cpu`、`memory` | `SandboxSet` 的 Pod `resources`，不是这个插件发送的创建正文。 |
| `ports`、`env` | Pod spec。插件没有映射。 |

创建用的凭证：`ABX_ALICLOUD_CONTAINER_DOMAIN`、`ABX_ALICLOUD_CONTAINER_API_KEY`，可选 `ABX_ALICLOUD_CONTAINER_BASE_URL` 和 `ABX_ALICLOUD_CONTAINER_PROTOCOL`。推镜像用集群节点拉得到的 ACR（VPC 仓库地址）。插件今天没有 ACR 或 Kubernetes 配置。

已验证：插件、清单、README，以及 ACS 文档页。未验证：模板 `list`/`get` 的真实响应，以及任何能创建 `SandboxSet` 的 HTTP。在确认那条 API 之前，把“deploy 能造出模板 id”视为不支持。

### 3.5 `opensandbox`

插件：`awesome-providers/opensandbox/provider.mjs` 和 `src/sandbox.mjs`。`sandbox.create` 用 `resolveImage` 把模板字符串变成镜像 URI：空或 `base` → `default_image`（`python:3.12-slim`）；配置的别名（`code` → `opensandbox/code-interpreter:v1.1.0`）；其他字符串按 URI 使用。正文是 `image.uri`、`entrypoint`、`resourceLimits`（`cpu` 用毫核，`memory` 如 `512Mi`），以及可选的 `image.auth`、`env`、`timeout`、`metadata`、`networkPolicy`、`platform`、`secureAccess`。插件随后等到状态 `Running` 且 execd 的 `/ping` 有响应。`templates.list`、`templates.get`、`templates.delete`、`templates.build`、`templates.build_status` 被写死成不支持错误，因为清单没有声明这些功能。

上游生命周期规范（2026-10-15 抓取的 `alibaba/OpenSandbox` `main` 上的 `specs/sandbox-lifecycle.yml`）：创建在 `image`、`snapshotId` 和池引用里取一个。给了 `image` 就必须有 `entrypoint`。非池模式必须有资源限制。提供方 README 实测过的运行时是 Docker（2026-10-14 本机 1.1.1：创建、执行、文件、终端、端口 URL）。

`POST /v1/templates` 创建 fsb 黄金镜像模板。规范写明它在 `kubernetes` 和 `fsb` 运行时上可用，Docker 上返回 501。请求体（`CreateFsbTemplateRequest`）必填 `image` 和 `publish`（S3 风格的目标）。可选：`resourceLimits`、`entrypoint`（默认 `["tail", "-f", "/dev/null"]`）、`env`、`metadata`、`readiness`、`format`（`native` 或 `overlaybd`）。轮询 `GET /v1/templates/{templateId}`，直到 `status.phase` 为 `Succeeded` 或 `Failed`。模板 id 形如 `tpl_…`。内核、execd 和客户机初始化来自服务端配置，不是客户端字段。已经用该模板创建的沙箱在删除模板后仍保留自己的产物。

| 字段 | OpenSandbox |
|---|---|
| `base` | 构建并推送的那份镜像。`sandbox.create` 把这个引用当作 `template`。 |
| `generation` | 不支持。 |
| `start_cmd` | `entrypoint` 参数数组。提供方的 `entrypoint` 配置会覆盖镜像。通用镜像用 `tail -f /dev/null` 保持运行，这样 execd 才能提供执行和文件。在 9000 端口提供服务的生成镜像把 `entrypoint` 设成 `python3 commands.py`。 |
| `ready_cmd` | 创建请求没有这个字段。插件等待 `Running` 和 execd `/ping`。Fsb 的 `readiness` 只在 `POST /templates` 上。 |
| `cpu`、`memory` | `resourceLimits.cpu`（`2` → `2000m`），`resourceLimits.memory`（`2048` → `2048Mi`）。创建时省略则插件默认 `500m` 和 `512Mi`。 |
| `ports` | 不是创建字段。`ports.url` 调用 `GET /v1/sandboxes/{id}/endpoints/{port}`。 |
| `env` | 创建请求上的 `env` 对象。Fsb 模板把环境变量烤进黄金镜像。 |

凭证：`ABX_OPENSANDBOX_BASE_URL`（默认 `http://127.0.0.1:8080`），可选 `ABX_OPENSANDBOX_API_KEY`（`OPEN-SANDBOX-API-KEY`）。私有镜像用 `registry_username` 和 `registry_password`（`image.auth`）。服务器必须拉得到这个引用。Fsb 构建还需要 S3 的 `publish` 目标，今天没有这个配置字段。

已验证：插件源码、清单、提供方 README，以及生命周期规范。未验证：对 Kubernetes 运行时的一次真实 `POST /templates`，以及本 CLI 推上去的镜像被真实拉取。

## 4. 其他提供方能不能在插件里做同样的事

注册、等待、删除这一半可以。如果“同样的事”是指插件自己跑 Docker 和 ACR，则不行。

- CLI 保留步骤 1、本地构建、推送助手和 yaml 缓存。这些对每个提供方都一样，已经在 `build_plan.ts`、`docker_builder.ts` 和 `template.ts` 里。
- 插件对着自己的 API 实现步骤 4–7；能远程构建时也实现步骤 2。
- `e2b` 可以收下规范化的步骤列表并返回模板 id，公开基础镜像时不需要本地 Docker。前提是 Dockerfile 指令在支持集合里，并且实现者能上传 `COPY` 的源文件。
- Docker 上的 `opensandbox` 没有对象要注册。Deploy 推送镜像并返回该引用。`sandbox.create` 已经接受它。Fsb 模板 API 是同一方法在 Kubernetes 上的第二种实现。
- `cubesandbox` 注册镜像并等待任务。插件需要仓库凭证和探测端口。
- `alicloud-container` 不能通过这个插件使用的 HTTP API 造出模板 id。Deploy 可以推送镜像，并写明操作者必须提交的 `SandboxSet`；那些路由接上之后也可以 list 或 get。在创建 API 出现之前，它不应该声明 `template.deploy`。镜像覆盖元数据仍然需要已有模板 id，所以表上的标签仍是“需要已有模板 id”。

`express_e2e.py` 和 SDK 随后能按提供方工作，是因为它们调用 `abx template deploy`（或引擎），提供方 id 选中插件。脚本仍然需要该提供方的凭证和拉得到的仓库。没有这些时，它不应该把该提供方写成已验证。

## 5. 协议变更（批准前不要实现）

### 5.1 功能 id

新增四个可选 id。不要删除或重命名 `src/providers/base.ts` 里现有的 18 个：

| Id | EPP 方法 | 引擎 | CLI |
|---|---|---|---|
| `template.deploy` | `template.deploy` | `POST /v1/templates` | `template deploy`、`template build`、`template push`、`template create`、`template install`（`--download-only` 除外）、`deploy` |
| `template.list` | `template.list` | `GET /v1/templates` | `template list` |
| `template.get` | `template.get` | `GET /v1/templates/:id` | `template info` |
| `template.delete` | `template.delete` | `DELETE /v1/templates/:id` | `template delete` |

`src/providers/manifest.ts` 在安装时拒绝 `FEATURES` 以外的 id（`unknown feature(s): …`）。`awesome-providers/docs/authoring.md` 和 `docs/en/create.md` 写的是同一个 18 个 id 的封闭列表。宿主允许列表变长之前就让插件声明 `template.deploy`，`abx provider install` 会失败。顺序：宿主允许列表、`docs/design/fixtures/epp-methods.json`、引擎，以及 Python SDK 里的同一份列表，放在同一次发布；插件放在下一次。

旧插件不声明新 id，安装行为与现在相同，deploy 得到 `E8004`。引擎对同一个缺口返回 `501`（[engine-api.md](../../en/reference/engine-api.md)）。

`templates.read` 和 `templates.build` 留在这 18 个里。一个发布周期内宿主把它们当作别名：`templates.read` 满足 `template.list` 和 `template.get`；`templates.build` 满足 `template.deploy` 和 `template.delete`。内置提供方继续声明旧 id，这样现有清单和文档仍然有效。目录插件只声明自己实现了的新 id。内置提供方自己改用新 id、提供方指南里的表也更新之后，下一个发布再去掉这个别名。`orderedFeatures` 已经会把未知 id 追加到末尾；安装拒绝意味着清单不能依赖那条路径。

`initialize` 可以带一个可选的 `template` 对象。只读 `features` 的宿主忽略它。

```json
{
  "build": "remote",
  "accepts": ["image", "steps", "dockerfile"],
  "push": "none"
}
```

`build` 取 `local`、`remote` 或 `none`。`accepts` 是该方法能处理的请求形式。`push` 取 `none` 或 `registry`。缺了这个对象时 CLI 不猜测：它只在本地构建并推送之后发送 `image`，这与极速版一致。

### 5.2 请求和响应

`template.deploy` 的参数：

```json
{
  "name": "my-template",
  "alias": null,
  "source": {
    "kind": "image",
    "image": "registry.example.com/ns/my-template:latest"
  },
  "spec": {
    "cpu": 2,
    "memory_mb": 2048,
    "disk_mb": null,
    "ports": [9000],
    "env": {"LOG_LEVEL": "info"},
    "start_cmd": null,
    "ready_cmd": null,
    "entrypoint": ["python3", "commands.py"],
    "generation": null
  },
  "registry": {"username": null, "password": null},
  "force": false
}
```

`source.kind` 的取值：

| kind | 字段 | CLI 何时发送 |
|---|---|---|
| `image` | `image`（字符串引用） | 推送助手完成之后，或计划本身已是提供方能拉的镜像。 |
| `steps` | `image`（基础镜像）和 `steps`（`[{ "type": "RUN", "args": ["…"] }]`，即 `build_plan.ts` 的形状） | 提供方 `build` 为 `remote` 且 `accepts` 含 `steps`。 |
| `dockerfile` | `dockerfile`（文件文本）和 `files`（`[{ "path", "sha256", "bytes_b64" }]`） | 提供方 `accepts` 含 `dockerfile`。Dockerfile 没有 `COPY` 或 `ADD` 时省略 `files`。 |

CLI 在调用前把 `template.yaml` 规范化进 `spec`。提供方忽略自己不支持的字段，并在一条进度事件里列出被忽略的字段，让命令输出看得见。映射不可能时拒绝调用（Cube 没有镜像、容器版没有 `SandboxSet` API）。

结果：

```json
{
  "template_id": "tpl_or_platform_id",
  "ref": "registry.example.com/ns/my-template:latest",
  "status": "ready",
  "build_id": "bld_123"
}
```

`template_id` 是传给 `sandbox.create` 的 `template` 字符串。Docker 上的 OpenSandbox 这个字符串就是镜像引用，`ref` 与它相同。`status` 取 `ready`、`submitted` 或 `error`。提供方没有构建对象时 `build_id` 为 null。

`template.list` 参数：`cursor`、`limit`。结果：`{ "templates": [{ "template_id", "name", "status", "ref" }], "next": null }`。

`template.get` 参数：`template_id`。结果：同样字段的一个对象，后端返回了规格时再加上 `spec`。

`template.delete` 参数：`template_id`。结果：`{}`。不存在的模板算成功，与 `sandbox.kill` 一致。

### 5.3 进度

EPP 在 `src/providers/epp.ts` 里已有两种流：方法为 `log` 的通知是调试行；带 `process_id` 的通知进入执行流的队列。模板部署复用通知。插件发出没有 `id` 的行：

```json
{
  "jsonrpc": "2.0",
  "method": "template.progress",
  "params": {
    "build_id": "bld_123",
    "phase": "register",
    "message": "pulling image",
    "progress": 40
  }
}
```

`phase` 取 `build`、`push`、`register` 或 `wait`。`progress` 是 0–100 或 null。宿主按 `build_id` 排队，方式与按 `process_id` 排队的执行事件相同。

引擎已经为 `commands/stream` 和 `files/watch` 提供 SSE。`POST /v1/templates` 在 `Accept: text/event-stream` 时写出 `progress` 事件和最后的 `result` 事件。JSON 调用方阻塞到结果记录。没有 `template.deploy` 时返回 `501`。错误正文仍是引擎的错误对象。

CLI 的步骤报告器（`template.ts` 里的 `_StepReporter`）打印这些事件。本地 docker 和推送的输出仍由它自己打印，因为那两步发生在提供方调用之前。

### 5.4 CLI 拆分

1. 解析提供方。要求 `template.deploy`。
2. `resolveBuildPlan` 和 `resolveDeployRuntime`（generation 与 start/ready 只对接受它们的提供方有意义；极速版接受）。
3. 从提供方描述里读 `template`。远程构建：发送 `steps` 或 `dockerfile`，跳过 Docker。否则 `_buildImage`，并且在 `push` 为 `registry` 时用 `_pushImage` 推到提供方配置里的仓库。
4. 调用 `template.deploy`。把 `template.yaml` 缓存在 `template_id`、别名和 yaml 名称下（`cacheDeployedTemplate` 已经实现）。
5. `template list|info|delete` 调用对应方法。它们不再直接导入 `fc_template.ts`。

极速版走到同一次调用后面。`AlicloudExpressProvider` 用现有的 `fc_template.ts` 函数实现这四个方法。ACR 推送留在 CLI，因为提供方声明的是 `build: local`、`accepts: ["image", "steps"]`、`push: registry`。步骤模式仍然跳过 Docker。`template.ts` 里不再把内置提供方当成特例。

### 5.5 界面

安装表从提供方信息读取 `template.deploy` 和创建参数的种类：

- 有 `template.deploy` → “可直接构建”。
- 没有，且创建接受的是不透明 id（`e2b`、`cubesandbox`、`alicloud-container`）→ “需要已有模板 id”。
- 没有，且创建接受的是镜像 URI（`opensandbox`）→ “先推送镜像”。

`abx provider info` 已经会打印功能 id。不需要新命令。手写标签会漂；功能标志才是来源。

## 6. 实现计划

这一节里的工作都还没有批准编码。

| 仓库 | 工作 | 工作量 | 风险 |
|---|---|---|---|
| `agent-sandbox` | 把四个 id 加进 `FEATURES`、清单校验、`epp-methods.json`、引擎路由和提供方指南（中英）。旧模板 id 在一个发布周期内做别名。把极速版的注册/等待/列出/删除挪到这些方法后面。构建计划、本地 Docker 和推送助手留在 CLI。 | 中等。行为变化在分发，不在新的极速版 API。 | 现有极速版部署测试继续通过、并且有一个假插件覆盖模式时，风险低。Python 夹具列表没有在同一次改动里更新时风险高：并排夹具测试会失败。 |
| `python-sdk` | SDK 允许列表和引擎客户端里同样的四个 id（`POST/GET/DELETE /v1/templates`）。不另写构建流水线。 | 小，必须和 CLI 改动一起落地。 | 低。只改 SDK 并不能部署。 |
| `awesome-providers` | 宿主发布之后，一个插件一个 PR。只声明该插件实现了的 id。在现有 `cli/tests/test_providers/test_node_plugins.test.ts` 的假服务旁边加测试。 | 见下面的顺序。 | 插件声明了宿主还不认识的 id 时，安装失败。 |
| `awesome-templates` | `scripts/express_e2e.py` 增加提供方参数，并在证据文件里记下该提供方。在该提供方的 deploy 可用之前，脚本仍只跑极速版。 | 小，至少一个插件之后。 | 低。脚本不得为没有真正部署的提供方写证据。 |

提供方顺序：

1. **E2B，第一个。** 用 `template.yaml` 的 `build:` 或解析后的 Dockerfile 做远程步骤，公开基础镜像，只需要 `ABX_E2B_API_KEY`。这条路径没有本地 Docker，也没有仓库。工作量：`RUN`/`ENV` 步骤为中低。风险：中等，因为 `COPY` 上传未验证，而且文档仍让调用方使用已被标成 deprecated 的 `POST /v2/templates`。Dockerfile 超出支持的指令集合时，必须报出那条指令，不能做半截构建。
2. **OpenSandbox 的 Docker 运行时，第二个。** 本地构建、推送、返回镜像引用。创建路径已经接受它。工作量：低。服务器能拉到该仓库时风险低。私有仓库用已有的 `registry_username` / `registry_password`。Fsb 的 `POST /templates` 是后面的一片（Kubernetes 加上 S3 的 `publish` 目标）。那一片工作量高、风险高。有集群之前不要声明。
3. **CubeSandbox，第三个。** `POST /templates` 加状态轮询。工作量：中等。风险：中高。节点必须拉得到镜像，探测必须对上进程，`envd` 注入可能只在 `cubemastercli` 上。镜像里没有 `envd`、又没有注入路径的模板，创建之后执行会失败。
4. **`alicloud-container`，最后。** 不要声明 `template.deploy`。管理器路由有响应的话，可以做可选的 `template.list` 和 `template.get`。把创建 `SandboxSet` 包进插件的工作量高，而且需要插件现在没有的 Kubernetes 凭证。风险高。表上诚实的标签仍是“需要已有模板 id”。

极速版是 CLI 那次改动里的参考实现，排在目录插件之前，这样模式先对着已经能用的流水线定下来。

## 7. 没有账号时能测什么

假 HTTP，不需要凭证：

- E2B：`POST /v2/templates`、`POST /v2/templates/{id}/builds/{buildID}`、`GET …/status` 返回 `ready`。断言步骤正文，并断言 `build: remote` 时没有调用本地 Docker。
- Cube：`POST /templates` → `202`，然后状态 `READY`。断言 `image`、毫核、探测和仓库字段。
- OpenSandbox：`POST /v1/sandboxes` 不是 deploy 方法。Deploy 返回镜像引用。Docker 假服务上的 `POST /v1/templates` 返回 `501`，这种情况下插件不声明 fsb deploy。
- 容器版：假的模板 list `GET`。功能缺失时 deploy 是 `E8004`。
- 安装器：带 `template.deploy` 的清单被今天的允许列表拒绝，允许列表变长后接受。带 `template.nope` 的清单始终拒绝。
- 引擎：没有该功能时 `POST /v1/templates` 返回 `501`；假插件先发 SSE `progress` 再发 `result`。
- CLI：在今天的二进制上，`abx --provider e2b template deploy` 在 Docker 之前就是 `E8004`。这条测试可以和文档一起落地，且不改变协议。本次改动没有加它，因为当前门闩已经如此，新测试本身是代码改动。

需要真实凭证，不能用假服务宣称：

- 一次达到 `ready` 的 E2B 构建，以及用该 id 创建的沙箱。
- 一次达到 `READY` 的 Cube 任务，以及经 envd 的执行。
- 一台 OpenSandbox 服务器拉到本 CLI 推送的镜像。
- 一个 ACS `SandboxSet`，以及针对它名字的创建。
- 极速版：内置提供方挪到 `template.deploy` 后面之后，把现有部署路径再跑一遍。
