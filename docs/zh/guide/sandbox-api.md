# 调用 Sandbox API

通过 `abx sandbox TARGET OPERATION` 调用指定沙箱中的服务。CLI 从固定的 OpenAPI 契约读取操作与帮助，实际地址由该沙箱的 Provider 提供。本页对应当前源码命令结构，不对应此前发布的 0.5.10。

契约不会安装服务。首先需要一个应用已在声明端口监听的沙箱。普通 REST 应用即可接入，不要求 Server SDK 的 `/commands`、`/capabilities` 等路由或 Shell 执行能力；Provider 必须支持解析应用端点。

## 声明与绑定

将 [registry.yaml](../../examples/sandbox-api/registry.yaml)、[openapi.yaml](../../examples/sandbox-api/openapi.yaml)、[request.json](../../examples/sandbox-api/request.json) 放在同一目录。示例描述报表服务，需要你已有的应用实现 `POST /totals`，示例请求对应响应 `{"total":60}`。

```yaml
apis:
  report:
    resource: sandbox.report
    port: 9000
    openapi: ./openapi.yaml
```

| 字段 | 含义 |
| --- | --- |
| `apis.report` | API 名称，可用 `--api report` 指定 |
| `resource` | 绑定时选择的逻辑 Sandbox 标签，格式为 `sandbox.NAME` |
| `port` | 已运行应用的端口，1～65535 的整数 |
| `openapi` | 相对于 registry.yaml 的包内 YAML/JSON 文件 |

OpenAPI 提供 HTTP 方法、路径、`operationId`、参数和请求体结构、说明、响应示例及认证要求。`servers` 不能覆盖实际 Provider 端点。资源标签不会创建资源，也不能证明服务已安装。

单 Sandbox 部署成功后，`deploy` 会导入源码包中可选的 `registry.yaml.apis`。当前部署入口会在部署前拒绝有歧义的多资源 registry。已有沙箱可通过 `--bind ... --resource sandbox.NAME` 显式选择一个声明的资源。没有 `apis` 的包仍可部署，使用此调用入口前需绑定契约。

下文 `report-demo` 是已有的本地沙箱部署名称，也可换成实际 Sandbox ID。Provider 使用已有配置；临时指定时使用 `abx --provider opensandbox sandbox ID ...`。Provider 选项放在 TARGET 之前，不能将已保存的绑定指向其他目标。

```bash
abx sandbox report-demo --bind ./registry.yaml \
  --credential report.token=env:REPORT_API_TOKEN \
  --alias totals=report:report_totals
```

通过自己的秘密管理方式，在 Shell 中设置 `REPORT_API_TOKEN`，值必须是该服务接受的应用令牌，与云凭据和 Sandbox 管理 Key 分开。绑定只保存变量名，不保存值；它不读取应用凭据或调用业务接口，会连接已有沙箱以确认身份。服务已使用 CLI 管理的应用令牌时，可显式指定 `report.token=config:server_token`。绑定不会改变服务端令牌。

模板声明了 `ABX_SERVER_TOKEN` 和 Server SDK v2 服务时，部署可以自动复用应用认证。CLI 先验证服务，确认 API 端口相同、Bearer 认证方案唯一，且实际注入沙箱的令牌与当前 CLI 配置来源一致，才保存凭据来源引用和令牌身份校验信息；API 绑定不保存令牌本身。该来源后续变化时，调用会在发送 HTTP 前停止，需要恢复原令牌，或显式重新绑定到服务实际接受的令牌来源。仅通过部署 `--env` 提供的自定义令牌不会自动保存，后续调用应显式绑定环境变量引用。导入任意 OpenAPI 文件不会让它自动获得 CLI 凭据。

`--bind` 替换该目标原有的契约、凭据引用和别名，重新绑定时需完整提供要保留的内容。别名固定映射一个 `API:OPERATION_ID`，不能覆盖已有操作名，只在本机此绑定中生效。对于一个操作，只绑定其一个认证分支需要的凭据引用。契约明确允许匿名访问且没有配置认证分支时，使用匿名访问；已尝试的认证请求不会降级成匿名重试。

缓存位于 `~/.abx/api-bindings`，使用私有文件权限，包含规范和路由信息。不要在 Schema 或示例中填写秘密。修改或删除原始文件不会更新已保存的契约；API 变化后需审查并重新绑定。帮助不会触发绑定。

## 发现与调用

```bash
abx sandbox report-demo --help
abx sandbox report-demo report_totals --help
abx sandbox report-demo report_totals --body @request.json
abx sandbox report-demo totals --body '{"values":[10,20,30]}'
abx --json sandbox report-demo report_totals --api report --body @request.json
```

目标帮助列出操作和别名，并标出客户端不支持的请求契约；操作帮助展示生成的选项及类型、方法、路径、请求结构、响应/示例、认证要求和客户端限制。两者均离线，不读取凭据。帮助反映声明的行为，不代表实时可用性或用户已获授权。

HTTP 输出保留状态与响应正文：

```json
{"status":200,"body":{"total":60}}
```

非 2xx 响应保持相同结构并返回退出码 1。无效输入在连接前失败，未知操作不会回退为 Shell 执行。请求不自动重试或跟随重定向。超时只表示停止等待，不证明远端执行已经停止。

| 选项 | 用法 |
| --- | --- |
| `--api NAME` | 多个 API 有同名操作时选择 API |
| `--path-NAME VALUE`、`--query-NAME VALUE`、`--header-NAME VALUE` | 从声明的标量参数生成的限定选项 |
| `--body-NAME VALUE` | 普通 JSON 对象请求体中的顶层标量属性 |
| `--NAME VALUE` | 字段名无歧义且不与 CLI 选项冲突时的简写 |
| `--body JSON` / `--body @FILE` / `--body -` | 完整 JSON 请求体，对象、数组、标量按 Schema 校验；`-` 显式读取管道输入 |
| `--output FILE` | 将成功响应保存到一个新文件，最多 8 MiB，保留原始二进制或 JSON 字节 |
| `--path NAME=VALUE` | 路径参数，可重复填写不同参数 |
| `--query NAME=VALUE` | 查询参数，可重复填写不同参数 |
| `--header NAME=VALUE` | 声明过的非认证请求头，不能覆盖网关/传输层请求头 |
| `--timeout SECONDS` | HTTP 请求期限，默认 30 秒，大于 0 且不超过 300 秒 |

对于声明了相应操作和参数的服务，可以组合使用：

```bash
abx sandbox report-demo get_report --reportId daily --detailed false
abx sandbox report-demo update_report --path-reportId daily \
  --header-x-request-id request-123 --body @request.json --timeout 60
```

如果操作的 JSON 请求体声明了字符串 `message` 和布尔值 `stream`，可以使用：

```bash
abx sandbox support-api ask --message "总结这份报告" --stream false
abx sandbox support-api ask --body-message "总结这份报告" --body-stream false
cat request.json | abx sandbox support-api ask --body -
abx sandbox support-api artifact_content --id artifact-123 --output ./report.pdf
```

这些操作名用于说明自己声明的契约，不属于前面的报表示例。标量选项都显式提供值，布尔值也不例外。如果路径和请求体都有 `id`，使用 `--path-id` 或 `--body-id`；请求体中名为 `timeout` 的属性使用 `--body-timeout`。嵌套对象、数组或组合请求体结构使用 `--body @FILE`。完整请求体与请求体字段选项不能混用。普通字符串属性中的 `@` 是字面内容，不会上传或读取本地文件。值以 `--` 开头时，使用 `--message=--literal`。

`--output` 不会覆盖已有文件，只有收到完整成功响应后才生成目标文件。非 2xx 响应继续返回状态与正文，不生成下载文件。输出 JSON 提供文件位置和字节数。二进制响应未指定 `--output` 时会明确报错，不会将任意字节转换为文本；响应收到后保存文件失败也不会重试请求。

上面的示意操作名需要服务提供对应声明，不属于前面的报表示例。`false`、`0`、显式空字符串不会被视为缺失。未知参数、重复赋值以及重复的 `--body` 等单值选项会报错。Schema 默认值和示例用于说明，CLI 不会自动填入。

## 支持范围与生命周期

支持 OpenAPI 3.1、每个 API 内唯一的 operationId、文档内 JSON Pointer 引用、JSON 请求体、采用标准 simple/form 序列化的标量 path/query/header 参数，以及 Bearer 和 header API Key 认证。暂不支持参数对象/数组、Cookie、外部或递归引用、Schema format、OAuth、云 AK/SK 签名、multipart、SSE 和 `x-abx-*` 调用扩展。外部引用需先合并进规范文件，不支持的能力会明确报错。响应正文直接返回，不进行响应 Schema 校验。

Registry/OpenAPI 文件和请求体分别限制为 1 MiB，绑定与 HTTP 响应分别限制为 8 MiB。Provider、Sandbox ID 和端口固定。本地部署已替换、删除或未就绪时，不能静默沿用旧绑定；原生 ID 必须对应一个确定的本地绑定，有歧义会报错。

通过 `abx status report-demo` 查看状态。资源归你所有且不再需要时，执行 `abx delete report-demo --yes`。业务调用不会自动续期或重建沙箱。文件、进程工具继续使用 `abx files`、`abx process`、`abx exec` 等[平台命令](../reference/cli-commands.md)，其可用条件独立于业务 API。
