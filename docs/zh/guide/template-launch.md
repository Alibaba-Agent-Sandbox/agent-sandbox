# 按显式工作流启动模板

`template launch` 解析源目录、校验 spec v4 清单，并根据 Provider 的具体操作、输入类型、启动模式和调用客户端协议支持检查所选工作流。应用 HTTP 工作流不要求 `code.execute` 或平台统一解释器。完整契约与安全规则见[模板工作流](template-workflows.md)。

```sh
abx --provider opensandbox template launch ./python-hello --workflow application --build-profile portable
```

示例显式选择 `build_profiles.portable`，保留原 Dockerfile。交互执行会确认构建与创建授权；已授权的非交互执行可加 `--yes`。源码构建需要所选 Provider 的凭据和原生构建条件，例如 OpenSandbox 所需 Docker、可写镜像仓库和仓库登录。OpenSandbox 服务必须可达，并能拉取构建后的镜像。Provider 成熟度与工作流支持、验证状态分别判断。

`--alias NAME` 设置构建关联名，`--timeout SECONDS` 设置准备期限（默认 600，最大 3600），`--sandbox-timeout SECONDS` 设置沙箱存活期（默认 300）。`--workflow ID` 选择已声明的路径；`--build-profile ID` 选择已声明的根目录 Dockerfile 和上下文。不再自动改写基础镜像、USER、COPY 或入口。Dockerfile 留有未解析平台占位符时，在准备资源前拒绝。

镜像工作流要求不可变镜像引用；托管工作流要求后端引用及一致的 Provider 归属。这两类输入不会当成源码构建。外部应用服务工作流通过 `--service-url` 指定 URL，应用令牌与平台凭据分别提供。

准备和创建前会核对源码快照与 Provider 代码。`startup: exec` 执行清单明确的启动命令；`startup: entrypoint` 使用所选 Provider 的原生启动方式。声明 `ready_cmd` 时要求 `exec.run`，并在报告成功前执行。应用协议检查使用具体沙箱与端口的端点，保留网关路径和查询参数，独立于 envd 传输，也不会匿名重试。

成功的 JSON 结果包含工作流、后端引用、沙箱、源码摘要、执行计划和资源日志。新建沙箱保留至主动删除或超时。启动失败时仅清理本次拥有的沙箱，并报告是否确认删除。镜像与已注册模板可能保留或需手工清理。超时可能留下结果不确定的资源，应根据资源日志中的关联标识核对后再重试。

新工作流实现通过仓库检查和真实 Provider 门禁后才可发布。源码可通过 `npm ci && npm run build` 构建，再用 `node dist/bin/abx.js` 执行；已发布的旧 CLI 不会仅因目录更新自动获得新契约。标准模板命令保留其固定版本的标准客户端契约。

第三方 Provider 集成仍标记为 Beta。工作流证据不等于完整原生协议面已经验收，正式原生验收属于独立门禁。
