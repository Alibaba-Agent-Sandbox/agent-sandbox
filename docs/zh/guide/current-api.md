# 当前开发接口

项目只维护当前接口。删除旧项目接口、导入别名、迁移命令和旧版本回退，不增加兼容包装。

- 提供方项目准备统一使用 `templates.build` 和 `buildTemplateManager(ctx).prepareProject`。E2B、CubeSandbox 的镜像登记帮助函数仅用于这条内部流程。
- 极速版模板操作使用官方 FCSandbox API；删除旧 REST 模板管理器和 API 选择开关。
- CLI 配置使用 `sandbox_api_key`、`sandbox_base_url`、`sandbox_domain` 及提供方字段。删除 `config check/migrate`、`--legacy-names`、平铺 TOML 回退和旧 LLM 明文配置回退。
- Python 提供方扩展使用 `ProviderSandbox` 和规范的 `sandbox_*` 参数，从所属提供方模块导入实现。标准 `Sandbox`、`AsyncSandbox` 保留当前固定的上游行为契约。
- 沙箱服务端文件传输使用 `/files/upload-stream`、`/files/download-stream`。删除旧传输路由和对应客户端方法。认证统一使用策略 token；显式 token 策略优先于便捷服务端 token 环境变量。
- 端口访问由所选提供方提供。远程独立服务端客户端必须显式提供 `pty_url`，本机继续使用约定的 PTY 端口。
- 提供方目录元数据只接受版本 3。每个模板必须声明支持的规范，`--all` 检查所有模板。

历史工程证据保留其原始版本的事实，不会启用已删除接口。

所有提供方的沙箱文本输出统一使用带提供方前缀的标识，JSON 包含提供方信息。模板索引必须显式声明受支持的 schema 版本。

配置导出统一使用 `storage` 字段，删除不生效的 `max_retries`、`retry_base_delay` 和重复的 GlobalConfig 模型；显式调用的重试工具仍可使用。按环境文件约定存储的凭据不再从明文 TOML 读取。
