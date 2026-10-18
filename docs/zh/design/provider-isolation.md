# Provider 实现边界

所有生命周期操作均选择一个 `Provider`，内置极速版也走同一条路径，不再用 null
绕过 Provider。核心 API 依赖结构化协议和认证契约，不实例化云 SDK、不交换云凭据、
不推导后端地址，也不替后端选择协议。

## 职责归属

| 职责 | 归属 |
| --- | --- |
| Provider 选择、授权同意、完整性校验、输出、通用配置优先级、客户端资源关闭 | 宿主 |
| 认证、端点、协议映射、后端错误和状态、生命周期、可选创建参数 | 所选 Provider |
| 模板认证、构建、注册、轮询、删除以及 Docker/镜像仓库细节 | Provider 模板实现 |
| 模板源码搜索下载、项目生成、运行时验证 | 宿主，通过所选 Provider 的元数据和工厂调用 |
| 极速版 SDK、AK/SK 签名和换取凭据、FC/ACR 部署、CLI 参数和提示、AI 管理工具定义 | `providers/alicloud_express/` |
| 可复用的 E2B/envd 协议及 token 头格式 | `providers/shared/e2b/`，由 Provider 显式选用 |

发行包的组装入口注册内置适配器、配置描述、CLI 扩展和 AI 扩展。生成的配置目录属于
声明式兼容数据。历史 `api`、`protocol`、`transport` 路径保留导出兼容层，不保留第二份
实现或核心兜底。共享 HTTP/Connect 传输处理帧和连接复用；认证和协议由 Provider 选择，
传输层不选择云后端。

## 模板适配

CLI 提供可选工厂 `Provider.buildTemplateManager(config, feature)`，返回
`list`、`get`、`delete`、`build`、`buildProject` 中实际支持的方法及 `close`。
Node 插件可在 `buildInfra(ctx)` 之外实现 `buildTemplateManager(ctx)`，获得同样经过
过滤的配置、已同意继承的字段和 HTTP 工具。调用前检查安装完整性和功能声明；查询或
构建模板不会顺带调用沙箱生命周期工厂。成功或失败都会关闭工厂持有的资源，类方法
保留自己的 receiver。缺少工厂或操作返回 E8004，单独声明 feature 不代表实现了能力。
通用模板写操作在创建工厂之前要求明确确认。

只有 Provider 实现了 `buildProject` 时才接收本地项目目录。该契约不自动激活另行提议
的镜像专用 `buildTemplates(ctx)`，不替仅接受模板 ID 的后端创建模板，也不补造 PTY。
每项能力仍须后端实际支持并通过其真实环境验证。

## 会话绑定与兼容

Provider 提供协议构建、会话认证、URL 推导、能力解析和终端打开。代码注册的 Provider
若明确复用共享 E2B 沙箱协议，可使用该协议的认证绑定钩子；其他协议默认只获得不添加
HTTP 头的 opaque token。缺失协议组返回 E8004。`volume_mounts` 等可选创建输入需要
Provider 显式声明 `createOptions` / `create_options`，在 I/O 前检查。

创建新沙箱后绑定失败，会尝试删除本次创建的资源并关闭客户端；连接失败只关闭客户端，
保留借用资源。外部 Provider 不继承极速版域名或 region 默认值，未声明的极速版裸配置
键会被拒绝。同一进程切换 Provider 会重新生成 CLI 参数和 AI 工具定义，避免模块缓存
残留原后端的参数或工具。

## 更新与迁移

保留公开导入路径，极速版仍随发行包内置。内置适配器跟随宿主版本更新；
`provider update alicloud-express --check` 返回 `bundled` 和升级指引。
Git 插件继续使用已有的校验、授权同意和回滚更新流程，详见
[迁移边界与更新](provider-portability-and-updates.md)。解耦不等于 SDK 零改动迁移，
也不会升级正在运行的沙箱或使各后端自动达到相同能力。
