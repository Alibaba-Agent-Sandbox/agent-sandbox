# 从已推送镜像创建提供方模板

`abx template from-image` 通过所选提供方独立的 `templates.deploy` 工厂转换已推送的 OCI 镜像。此命令不运行 Docker，也不调用极速版的 ACR/模板接口。现有 `template build`、`push`、`create`、`deploy`、`install`、`list`、`info` 和 `delete` 保留各自的旧能力门禁。

```sh
abx --provider PROVIDER template from-image docker.io/example/runtime:v1 --name runtime:v1 --cpu 2 --memory 1024 --timeout 600 -y
```

`PROVIDER` 必须声明 `templates.deploy` 并实现 `buildTemplates(ctx)`。当前 E2B 目录清单尚未声明此能力。[提供方 PR 5](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/5) 的适配器仍待宿主/共享 schema 交付与原生云验收；安装当前未经改动的目录不会启用此命令。极速版也不声明新能力。

| 参数 | 规范 |
| --- | --- |
| `IMAGE` | 必填，可拉取的 OCI 引用；不含 URL 协议、内嵌凭据、查询或片段 |
| `--name` | 必填的提供方模板名，可含标签 |
| `--cpu`、`--memory` | 可选正整数，单位为核和 MiB |
| `--start-cmd`、`--ready-cmd` | 可选非空构建时命令；启动命令必须同时设置就绪命令 |
| `--timeout` | 默认 600 秒；有限数值，大于 0 且不超过 3600 |
| `-y`、`--yes` | 跳过构建与费用确认 |

提供方凭据使用独立命名空间，例如 `ABX_E2B_API_KEY`，不会借用极速版或原生 SDK 回退密钥。私有镜像需通过环境变量同时提供 `ABX_IMAGE_REGISTRY_USERNAME` 和 `ABX_IMAGE_REGISTRY_PASSWORD`。不要把秘密写进镜像引用或命令参数。

成功的 `--json` 结果仅含 `template_id`、`build_id`、`status: "ready"` 和 `ref`。请求无效时在创建工厂前失败；不支持的提供方在 Docker、仓库及云操作前返回 E8004。远端原始错误与取消原因不会透传。超时/取消停止等待，已提交的远端构建可能仍存在，应检查提供方控制台。关闭工厂仅释放本地 HTTP 资源，不会删除远端模板。

E2B 镜像构建需要 Node.js 22+ 和固定的可选包 `e2b@2.55.0`。普通沙箱操作保留原有 Node.js 支持，不加载该 SDK。安装 CLI 时需启用可选依赖；Node 20 在此路径返回宿主前置依赖错误。

## 插件契约与验证

`Provider.buildTemplates(config)` 和可选的 node/1 `buildTemplates(ctx)` 返回 `{deploy(input), close?()}`。输入仅支持镜像：`{source:{kind:"image",image},name,spec?,registry?,timeout?,signal?}`。`spec` 仅接受 `cpu`、`memory`、`start_cmd`、`ready_cmd`，registry 仅接受 `username`、`password`。工厂应遵守取消与期限，并在失败时关闭自建资源。`templates.build` 不隐含该工厂。Python SDK 对应 schema 接受能力声明，但未增加 Python 部署 API。

先运行 `npm run build`，再运行 `ABX_E2B_PROVIDER_SOURCE=/path/to/reviewed/e2b node e2e/providers/template-image.mjs`。脚本在临时清单中显式启用能力，通过真实本地安装、已构建 CLI、实际适配器及固定官方 SDK 请求回环服务，检查独立凭据、私仓认证与返回字段后清理临时存储和服务。这不证明原生 E2B 构建或沙箱执行；原生 build/create/execute/kill 仍需已授权 E2B 账号，发布门槛尚未满足。
