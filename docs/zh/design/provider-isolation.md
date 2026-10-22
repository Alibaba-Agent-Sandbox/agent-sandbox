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
| 极速版 SDK、管理面签名、显式自定义凭据交换、FC/ACR 部署、CLI 参数和提示、AI 管理工具定义 | `providers/alicloud_express/` |
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

## 与当前宿主整合

通用命令和 Provider 扩展均使用独立的 `cli/error_handler.ts` 渲染错误，回调不导入
CLI 根模块。认证错误由所选认证适配器分类。极速版沙箱调用需要沙箱 API Key；
管理面 AK/SK 不会在沙箱操作中隐式创建密钥。

E2B/envd URL 格式由协议适配器维护。两种配置视图的历史 URL 方法只委托发行包的
兼容构建器。已淘汰的原始 Dockerfile `POST /templates` 构建路径保持移除；项目发布
使用 Provider 自己的 CLI 扩展，已推送镜像使用当前适配接口。缺失的可选模板方法
返回 E8004。工具发现保留公共顺序，并按所选 Provider 重新生成 Schema。

## 端口与文件 URL 的归属

同步端口访问和项目服务的网关鉴权头由所选适配器实现。只有异步端口发现能力的
Provider 应调用 `await sandbox.network.resolve(port)`；同步辅助方法返回 E8004，
不会猜测极速版或 E2B 地址，也不会发送其他后端的令牌。独立构造网络模块时仍保留
已文档化的内置兼容行为。文件传输 URL 是文件系统适配器的可选钩子；即便会话地址
使用 HTTP，缺少钩子也返回 E8004。核心不会为其他 Provider 构造 `/files` 路由。

Python 中立传输和协议模块的导入不会加载内置认证或具体协议；显式请求历史兼容
导入时再延迟解析。

内置配置、镜像和历史 URL 规则的纯元数据仍由 Provider 维护。底层配置通过发行版
组合与兼容导出读取声明数据，不导入认证或运行时适配器。兼容 URL 方法委托给声明的
模板或已组合的 Provider 构造函数。
