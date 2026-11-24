# 整体启动模板

用 `abx template build SOURCE --out FILE --yes` 准备 Sandbox 模板，再用 `abx create --build FILE --name my-app --yes` 创建实例。创建时会执行声明的 `start_cmd`、等待 `ready_cmd`，并解析 `provides` 中的全部服务地址。

Sandbox 模板使用 `spec_version: 5`。托管应用模板请参见独立的[托管应用指南](managed-applications.md)。应用服务、命令、依赖和启动脚本属于同一个模板；`provides` 描述所有服务端点，启动脚本可以启动多个进程。业务命令在启动后按需调用，不会自动执行。Agent Sandbox Server v2 服务通过健康、协议发现和命令目录验证，不执行业务命令。其他服务协议由声明的就绪命令检查，并返回 Provider 提供的访问地址；CLI 不声称理解这些应用协议。

源码模板使用 Dockerfile 或平台支持的构建配方。作者可以固定 `image`，或固定所属 `provider` 与 `template_id` 来引用已准备的制品；这些是模板内容，不是用户要选择的执行模式。镜像引用要求不可变的 `@sha256:` digest。凭据、上传、注册和平台地址仍由 Provider 处理。CLI 在创建资源前检查所需的平台操作。

对 Provider 管理的目录条目，使用 `abx --json template info NAME` 查找 `manifest.provider` 和 `manifest.template_id`，再传给 `abx --provider PROVIDER create --template-id TEMPLATE_ID --name my-app --yes`。已有外部服务使用 server client 连接。

## 从 v4 迁移

删除 `workflow_contract_version`、`default_workflow` 和 `workflows`，改为 `spec_version: 5`。保留全部 `provides`、`start_cmd`、`ready_cmd`、环境变量和应用代码。启动命令删除 `--workflow` 与 `--service-url`。当前 CLI 对 v4 清单给出迁移错误，不会猜测旧流程。CLI 与模板目录需要同步升级；旧二进制无法读取 v5 清单。

已有验证记录保留其当时版本的历史意义。静态操作检查不等于真实平台测试，也不证明当前账号配置或服务已经就绪。

遇到清单版本不符时，请选择包含当前 v5 清单的源码提交。如果远端源码已经更新，但下载的副本仍然陈旧，只删除错误提示中指明的该模板缓存目录，然后重试。`abx template list --refresh` 刷新的是目录索引，不是已下载的源码。固定的旧 Git 提交不会因为删除缓存而变成新版本。CLI 不会自动修改或删除源码文件。
