# 部署托管 Agents 应用

托管应用对外提供一个 Gateway 地址，Session 按需创建隔离的 Sandbox 计算环境。
用户在不同会话和应用升级后仍使用同一地址。此流程支持阿里云极速版与函数计算上的
`spec_version: 6`、`managed-bridge-v1` 模板。请使用包含 `abx app --help` 的源码版本构建的 npm CLI；
CLI 0.5.8 尚未包含这些命令。部署主机需要 Node.js 20+、Docker、ACR 命名空间及模板 smoke 脚本的 Python 依赖。

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
| Client authentication | `{ "generate": true }` 在首次 apply 生成默认业务 Key；也可显式提供令牌 SHA-256 摘要、owner 和 scopes。外部客户端用原始业务 Key 作为 Bearer 令牌。 |
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

默认业务和内部控制 Key 仅在首次 `apply` 时生成，以私有权限保存在当前用户的应用凭据存储，后续命令复用。
输出提供 `credentials_file`；外部客户端可在本机安全读取其中的 `businessKey`，请安全备份该文件。
显式绑定只作为本次输入，不会自动复制保存。仍保留旧 revision 时，不要更换内部控制 Key。
Sandbox 应用令牌 `ABX_SERVER_TOKEN` 是另一个独立的 guest 控制凭据。

模板的 `application.deployment.accessRef` 可设为 Serverless Devs 凭据配置名、使用已配置极速版 AccessKey 的
`abx`，或使用显式云凭据环境变量的 `env`。执行前通过 STS 核对身份。现有极速版模板准备适配器要求部署 AccessKey，
此流程暂不支持仅 STS 的模板准备。`app` 不会自动创建或续期管理 API Key。

先构建并审阅计划，再执行：

```bash
abx app build template.yaml --out .abx/build.json --yes
abx app plan template.yaml --build-receipt .abx/build.json --out .abx/plan.json
abx app apply .abx/plan.json --bindings .abx/bindings.json --yes
```

尚未被应用使用且归属已确认的 Server 构建可通过 `abx app clean-build .abx/build.json --yes` 回收。
apply 记录使用后，只能经应用 retire/destroy 生命周期清理。推送失败会保留随机 tag 与 journal；
远端结果未知时须先通过原生查询核实，再进行清理。

`build` 准备固定 digest 的 Server 镜像与固定版本 FC 组件依赖。`plan` 只读取本机输入，不生成凭据或云资源。
计划有效期 24 小时；源码、工具或上一份收据改变后须重新生成计划。生成文件放在构建排除的 `.abx/`。
`apply` 准备独立命名的 Sandbox Template，部署三个函数，执行模板候选业务验证，再发布稳定 Gateway 别名。
收据给出 `endpoint` 和 `receipt_file`，外部客户端只需配置此地址与业务 Key。
FC 内置域名仅供测试；生产环境使用既有 HTTPS 自定义域名。

升级时重新构建，并将上次 ready 收据传给计划：

```bash
abx app plan template.yaml --build-receipt .abx/build.json \
  --previous-receipt .abx/previous.receipt.json --out .abx/update.json
abx app apply .abx/update.json --bindings .abx/bindings.json --yes
abx app status .abx/current.receipt.json --bindings .abx/bindings.json
```

请使用 apply 返回的实际收据路径。既有 Session 继续使用原 Worker 和 Sandbox Template，新 Session 使用新 revision。
多台主机的部署须在部署系统中串行执行。CLI 只排斥本机并发部署；FC 别名更新不提供分布式 compare-and-swap 保证。

`status` 查询已记录原生资源，提供 bindings 时也查询持久活动状态。`reconcile` 在中断后刷新观察结果，
不会重放资源创建或发布。结果未知时保留恢复身份；本机停止等待不能证明云端工作已停止。

```bash
abx app reconcile .abx/current.receipt.json --bindings .abx/bindings.json --yes
abx app retire .abx/current.receipt.json --revision <old-revision> \
  --bindings .abx/bindings.json --yes
abx app plan --destroy .abx/current.receipt.json --out .abx/destroy.json
abx app destroy .abx/destroy.json --bindings .abx/bindings.json --yes
```

retire 先阻止旧 revision 接受新 Session 和输入，关闭剩余可复用 Session，确认清理完成后才删除资源。
destroy 先阻止新输入并排空所有已记录 revision，再删除确认归属的资源，包含升级失败后仍保留的资源。
请保留历史收据，它们用于确认保留资源及其控制函数。排空或删除未完成时保留收据，观察进度，
然后重试 retire 或生成新的销毁计划。数据库、模型账号、执行角色和自定义域名属于外部提供资源，由用户管理。
完整销毁后，数据库仍保留停止接收输入的状态和历史。再次创建应用时须使用新的模板应用名或新的空状态数据库；
正常更新 revision 应提供上一份 receipt。apply 不会自动重新开放已排空的账本。
本流程拥有的 Server tag 在应用记录的引用消失后删除；外部提供的 `serverImage` digest 按借用资源保留并原样交给 FC。
若所选镜像仓库路径拒绝 digest 输入，请使用托管 Server 构建配方；它向 FC 提交独立自有 tag，并核对 FC 解析的 digest 与冻结计划一致。
CLI 在镜像准备与更新完成后才调用或发布函数；失败时保留恢复收据。
Sandbox 构建镜像仍在恢复输出中保留手动清理记录；确认没有保留模板或函数引用后，再使用 ACR 工具删除这些明确镜像。
