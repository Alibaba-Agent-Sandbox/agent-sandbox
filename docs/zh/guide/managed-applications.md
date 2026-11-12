# 部署托管 Agents 应用

托管应用对外提供一个 Gateway 地址，Session 按需创建隔离的 Sandbox 计算环境。
用户在不同会话和应用升级后仍使用同一地址。此流程支持阿里云极速版与函数计算上的
声明 `specVersion: 1` 和 `application.type: agents-api` 的模板。请安装[当前源码 CLI](../../../README.zh-CN.md#安装)；已发布的 0.5.10 使用原命令布局。部署主机需要 Node.js 20+、Docker、ACR 命名空间及模板 smoke 脚本的 Python 依赖。

从 [Agents API 模板](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/main/agents-api)开始。
模板包含 Sandbox 镜像、Server 构建文件、原生配置引用和业务验证脚本。API 是受 OpenAI Agents 启发的子集，
明确区分排队和关闭计算；受支持请求以模板 API 指南为准。
SSE 每次连接返回最多 20 秒的有限片段；请保存持久事件游标并通过 `Last-Event-ID` 重连。
一次流片段结束不代表本轮任务已完成。

使用一个 `template.yaml`：`deployment` 声明原生 FC 资源，`application` 声明应用设置；本地运行不要求 `registry.yaml`。通过进程环境或私有本地 `.env` 提供原生 `${env('NAME')}` 引用。后续 apply/update 需要保留原始配置目录；密钥值不进入源码快照或持久计划。

托管流程只接受 `application.roles` 引用的三个资源，其资源 ID 可以自定义；额外的域名、网络或其他原生资源会在部署前明确拒绝。生产自定义域名须已存在，并独占一条指向本应用 Gateway 的 `/*` 路由，部署时更新该路由的 revision。DNS、证书和网络资源需另行准备。

| 输入 | 用途及来源 |
| --- | --- |
| `ABX_MANAGED_DATABASE_URL` | 已有独立 PostgreSQL 数据库的连接地址，由数据库管理员提供，三个 Server 角色均需可达。 |
| `SANDBOX_API_KEY`、`SANDBOX_BASE_URL`、`SANDBOX_DOMAIN`、`SANDBOX_REGION` | Sandbox 服务凭据和匹配的地域端点，Worker 用它们创建和清理 Session 计算资源。 |
| `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` | 模型服务商的 Key、HTTPS API 地址与实际可用模型；在 `application.bindings.model` 选择受支持的 `codex` 或 `qwen-code`。 |
| `AGENTS_FC_ROLE_ARN` | 已有 FC 执行角色，允许调用 Worker/Dispatcher，填入原生 FC `role`；它与部署机 AccessKey 不同。 |
| 部署身份 | 在 `deployment.access` 选择 Serverless Devs 凭据配置，单独准备云 AccessKey。 |
| 业务与内部认证 | 首次部署默认分别生成，安全保存在当前用户的本机应用凭据存储中并复用，不是向云控制台申请的 Key。 |
| 入口 | 在 `application.bindings.ingress` 选择已确认的 FC 测试别名，或已有 HTTPS 根自定义域名。 |

当前应用路径要求在预览/apply 前提供这些引用，暂不交互收集和保存任意应用字段。不要把密钥写入 YAML 明文或镜像上下文。

私网数据库可在 `application.state.vpcConfig` 填写已有的 `vpcId`、`vSwitchIds` 和 `securityGroupId`。数据库连接地址仍放在 `application.state.databaseUrl`，例如 `${env('ABX_MANAGED_DATABASE_URL')}`。
使用能访问数据库的既有网络 ID；CLI 不创建网络或修改访问规则，三个函数均接收此原生 VPC 配置。
此 profile 为模型与 Sandbox 地址显式启用 FC 公网访问，并在回读中核实。
数据库和公网地址的实际连通性仍须通过候选业务验证确认，参见
[FC VPC 公网访问说明](https://help.aliyun.com/zh/functioncompute/how-do-functions-in-a-vpc-access-the-internet-1)。
数据库 URI 须明确指定单个主机、数据库和用户，不支持 `host`、`options` 等路由或 schema 覆盖参数。
首次部署固定数据库持久身份，后续 revision 拒绝空库、替换后的账本或不同路由；数据库迁移须另行安排。
凭据轮换需要同时协调保留的 Worker，各 revision 在退役前继续使用原来解析的凭据。
数据库使用私有 CA 时，在 State 中增加 `databaseCa: "${file('/path/to/database-ca.pem')}"`，
或 `databaseCa: "${env('AGENTS_DATABASE_CA_PEM')}"`，URI 保持 `sslmode=verify-full`。
只接受不超过 64 KiB 的证书 PEM 链；此运行时 CA 只交付三个 Server 角色，不写入镜像、计划、收据或 Sandbox 环境。
CA 不占 FC 环境变量预算。每个角色的环境变量名与值合计不得超过 4 KiB UTF-8，包含候选认证和持久状态身份；
编译后的配置超限时，在创建 FC 函数前拒绝。较大的 CA 链仍须满足所选 FC 容器命令的实际大小限制。

默认业务和内部控制 Key 仅在首次 `deploy` 时生成，以私有权限保存在当前用户的应用凭据存储，后续命令复用。
输出提供 `credentials_file`；外部客户端可在本机安全读取其中的 `businessKey`，请安全备份该文件。
显式绑定只作为本次输入，不会自动复制保存。仍保留旧 revision 时，不要更换内部控制 Key。
Sandbox 应用令牌 `ABX_SERVER_TOKEN` 是另一个独立的 guest 控制凭据。

模板的 `deployment.access` 可设为 Serverless Devs 凭据配置名、使用已配置极速版 AccessKey 的
`abx`，或使用显式云凭据环境变量的 `env`。执行前通过 STS 核对身份。现有极速版模板准备适配器要求部署 AccessKey，
此流程暂不支持仅 STS 的模板准备。`deploy` 不会自动创建或续期管理 API Key。

预览并按应用名称部署：

```bash
abx deploy . --name my-agents --plan
abx deploy . --name my-agents --yes
abx status my-agents
```

`--plan` 检查本地模板并摘要列出资源，不构建或修改云端资源。`deploy` 构建 Server 镜像、准备
Sandbox Template、部署三个函数、验证候选应用并发布 Gateway，返回 `endpoint`、`credentials_file`
和 `receipt_file`。外部客户端使用 endpoint 和业务 Key；FC 内置域名用于测试，生产使用既有 HTTPS 自定义域名。

更新时修改项目，使用同一个名称再次执行 `deploy`。既有 Session 保留原 Worker 和 Sandbox Template，
新 Session 使用当前 revision。请保留本机部署记录及收据用于清理；多台主机的部署须由流水线串行调度，
本机锁不会协调独立主机。

```bash
abx status my-agents --revisions
abx recover my-agents
abx delete my-agents --revision OLD_REVISION --yes
abx delete my-agents --yes
```

`recover` 观察中断操作，不重复资源创建或发布。本机停止等待不能证明云端工作已经停止。
退役旧 revision 会先排空再删除其资源；删除应用会排空所有记录的 revision。
清理未完成时保留记录，通过 `recover` 查看进度，处理不确定结果后再重试删除。
已有收据可通过 `abx recover my-agents --receipt PATH` 导入。

`abx logs my-agents --role gateway` 读取已有 FC 日志库。默认配方没有配置 FC 日志，使用前需要配置函数
`logConfig` 及日志访问权限；暂不支持持续跟随应用日志。

模板作者可以单独构建，供多个部署复用：

```bash
abx template build . --out .abx/build.json --yes
abx deploy . --build .abx/build.json --name my-agents --yes
# 所有使用该构建的应用删除后：
abx template build --clean .abx/build.json --yes
```

显式传入的构建由作者管理，应用删除后保留；仍有部署使用时，CLI 拒绝清理构建。
部署自动产生的构建属于该应用的生命周期。输出中要求手动清理的镜像，需要在确认没有保留模板或函数引用后
使用 ACR 工具删除。

数据库、模型账号、执行角色及外部提供的自定义域名仍由用户管理。删除后保留数据库历史和停止接收输入的状态；
完整删除后再创建应用，须选择新的应用名或新的空状态数据库。`deploy` 不会自动重新开放已排空的账本。

托管 Sandbox 的自定义实例字段放在 `sandbox.instance`。`timeout` 是唯一最大存活期限，其他受支持资源参数传入 Session 创建。自定义环境值仅交给 Worker 的私有输入；模型与运行时变量名、归属标签属于保留项。存储卷不能覆盖 `/workspace` 或 `/home/user/.agent-sandbox`，生命周期要求超时删除且不自动恢复。当前托管生命周期不支持原生 FC 的 `auto` 网络/存储/日志资源、任意 native actions 或组件附属资源，请使用显式且已支持的已有资源配置。

观察和清理复用已保存的内部控制凭据与资源归属，不要求模型 Key 或原始源码目录。控制凭据缺失时需恢复原凭据，清理过程不会生成替代控制密钥。

FC 控制请求使用 `deployment.access: abx` 时，从同一次 CLI 配置读取 AccessKey ID、Secret 和可选 `security_token`。临时令牌可通过 `abx config set security_token` 或 `ALIBABA_CLOUD_SECURITY_TOKEN` 提供；显式 `env` 与 Serverless Devs 命名凭据配置继续使用各自解析方式。此 FC 路径的支持不代表 Express Sandbox Template 准备或模板清理已支持 STS。
