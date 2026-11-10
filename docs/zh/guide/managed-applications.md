# 部署托管 Agents 应用

托管应用对外提供一个 Gateway 地址，Session 按需创建隔离的 Sandbox 计算环境。
用户在不同会话和应用升级后仍使用同一地址。此流程支持阿里云极速版与函数计算上的
明确声明 `application.deployment.profile: fc-managed-agents` 的模板。请安装[当前源码 CLI](../../../README.zh-CN.md#安装)；已发布的 0.5.10 使用原命令布局。部署主机需要 Node.js 20+、Docker、ACR 命名空间及模板 smoke 脚本的 Python 依赖。

从 [Agents API 模板](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/main/agents-api)开始。
模板包含 Sandbox 镜像、Server 构建文件、绑定示例和业务验证脚本。API 是受 OpenAI Agents 启发的子集，
明确区分排队和关闭计算；受支持请求以模板 API 指南为准。
SSE 每次连接返回最多 20 秒的有限片段；请保存持久事件游标并通过 `Last-Event-ID` 重连。
一次流片段结束不代表本轮任务已完成。

将私有部署输入放到镜像构建上下文排除的目录：

```bash
mkdir -p .abx
cp bindings.example.json .abx/bindings.json
chmod 600 .abx/bindings.json
```

部署前配置示例中引用的环境变量。各绑定用途如下：

| 绑定 | 输入和来源 |
| --- | --- |
| State | 三个 FC 函数均可访问的既有 PostgreSQL 数据库 URL。请与数据库管理员准备专用数据库及访问规则。 |
| Sandbox access | 对应账号、地域的 Sandbox API Key、明确的 API URL、数据域名和地域，用于创建与清理计算环境。 |
| Model | 模型服务 Key、HTTPS 地址、明确的模型 ID 和受支持适配器。仅 Worker 解析并按模板声明向 guest 注入模型环境。 |
| Client authentication | `{ "generate": true }` 在首次部署 生成默认业务 Key；也可显式提供令牌 SHA-256 摘要、owner 和 scopes。外部客户端用原始业务 Key 作为 Bearer 令牌。 |
| Internal authentication | `{ "generate": true, "roleArn": { "env": "AGENTS_FC_ROLE_ARN" } }` 生成私有控制 Key。既有执行角色须信任 FC，并允许调用本应用的 Worker、Dispatcher。此角色与部署主机 AccessKey 分开。 |
| Ingress | 选择 `function-alias`，提供 `aliasName` 并显式设置 `allowTestDomain: true`；或提供既有独占 HTTPS 根域名绑定 `custom-domain` 的 `domainName`、`protocol: HTTPS`、`aliasName`。 |

私网数据库的 State 可写成 `{ "databaseUrl": { "env": "AGENTS_DATABASE_URL" },
"vpcConfig": { "vpcId": "vpc-…", "vSwitchIds": ["vsw-…"], "securityGroupId": "sg-…" } }`。
使用能访问数据库的既有网络 ID；CLI 不创建网络或修改访问规则，三个函数均接收此原生 VPC 配置。
此 profile 为模型与 Sandbox 地址显式启用 FC 公网访问，并在回读中核实。
数据库和公网地址的实际连通性仍须通过候选业务验证确认，参见
[FC VPC 公网访问说明](https://help.aliyun.com/zh/functioncompute/how-do-functions-in-a-vpc-access-the-internet-1)。
数据库 URI 须明确指定单个主机、数据库和用户，不支持 `host`、`options` 等路由或 schema 覆盖参数。
首次部署固定数据库持久身份，后续 revision 拒绝空库、替换后的账本或不同路由；数据库迁移须另行安排。
凭据轮换需要同时协调保留的 Worker，各 revision 在退役前继续使用原来解析的凭据。
数据库使用私有 CA 时，在 State 中增加 `databaseCa: { "file": "/path/to/database-ca.pem" }`，
或 `databaseCa: { "env": "AGENTS_DATABASE_CA_PEM" }`，URI 保持 `sslmode=verify-full`。
只接受不超过 64 KiB 的证书 PEM 链；此运行时 CA 只交付三个 Server 角色，不写入镜像、计划、收据或 Sandbox 环境。
CA 不占 FC 环境变量预算。每个角色的环境变量名与值合计不得超过 4 KiB UTF-8，包含候选认证和持久状态身份；
编译后的配置超限时，在创建 FC 函数前拒绝。较大的 CA 链仍须满足所选 FC 容器命令的实际大小限制。

默认业务和内部控制 Key 仅在首次 `deploy` 时生成，以私有权限保存在当前用户的应用凭据存储，后续命令复用。
输出提供 `credentials_file`；外部客户端可在本机安全读取其中的 `businessKey`，请安全备份该文件。
显式绑定只作为本次输入，不会自动复制保存。仍保留旧 revision 时，不要更换内部控制 Key。
Sandbox 应用令牌 `ABX_SERVER_TOKEN` 是另一个独立的 guest 控制凭据。

模板的 `application.deployment.accessRef` 可设为 Serverless Devs 凭据配置名、使用已配置极速版 AccessKey 的
`abx`，或使用显式云凭据环境变量的 `env`。执行前通过 STS 核对身份。现有极速版模板准备适配器要求部署 AccessKey，
此流程暂不支持仅 STS 的模板准备。`deploy` 不会自动创建或续期管理 API Key。

预览并按应用名称部署：

```bash
abx deploy . --name my-agents --plan
abx deploy . --name my-agents --bindings .abx/bindings.json --yes
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
abx deploy . --build .abx/build.json --name my-agents --bindings .abx/bindings.json --yes
# 所有使用该构建的应用删除后：
abx template build --clean .abx/build.json --yes
```

显式传入的构建由作者管理，应用删除后保留；仍有部署使用时，CLI 拒绝清理构建。
部署自动产生的构建属于该应用的生命周期。输出中要求手动清理的镜像，需要在确认没有保留模板或函数引用后
使用 ACR 工具删除。

数据库、模型账号、执行角色及外部提供的自定义域名仍由用户管理。删除后保留数据库历史和停止接收输入的状态；
完整删除后再创建应用，须选择新的应用名或新的空状态数据库。`deploy` 不会自动重新开放已排空的账本。
