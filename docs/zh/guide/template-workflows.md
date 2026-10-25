# 整体启动模板

执行 `abx --provider PROVIDER template launch TEMPLATE --yes`。模板只有一个启动入口：CLI 准备模板内容、创建沙箱、执行声明的 `start_cmd`、等待 `ready_cmd`，并解析 `provides` 中全部服务的地址。不再选择 workflow，也不再区分应用、执行命令或解释器等启动类型。

模板使用 `spec_version: 5`。应用服务、命令、依赖和启动脚本属于同一个模板；`provides` 描述所有服务端点，启动脚本可以启动多个进程。业务命令在启动后按需调用，不会自动执行。Agent Sandbox Server v2 服务通过健康、协议发现和命令目录验证，不执行业务命令。其他服务协议由声明的就绪命令检查，并返回 Provider 提供的访问地址；CLI 不声称理解这些应用协议。

源码模板使用 Dockerfile 或平台支持的构建配方。作者可以固定 `image`，或固定所属 `provider` 与 `template_id` 来引用已准备的制品；这些是模板内容，不是用户要选择的执行模式。镜像引用要求不可变的 `@sha256:` digest。凭据、上传、注册和平台地址仍由 Provider 处理。CLI 在创建资源前检查所需的平台操作。

目录中的平台内置模板直接按目录名称启动，例如 `abx --provider alicloud-express template launch base --yes`。CLI 直接读取目录中的托管模板声明，不复制一份源码清单。已有外部服务使用 server client 连接；启动模板总会创建沙箱。

## 从 v4 迁移

删除 `workflow_contract_version`、`default_workflow` 和 `workflows`，改为 `spec_version: 5`。保留全部 `provides`、`start_cmd`、`ready_cmd`、环境变量和应用代码。启动命令删除 `--workflow` 与 `--service-url`。当前 CLI 对 v4 清单给出迁移错误，不会猜测旧流程。CLI 与模板目录需要同步升级；旧二进制无法读取 v5 清单。

已有验证记录保留其当时版本的历史意义。静态操作检查不等于真实平台测试，也不证明当前账号配置或服务已经就绪。
