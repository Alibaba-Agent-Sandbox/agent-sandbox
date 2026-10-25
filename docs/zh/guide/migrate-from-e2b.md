# 从阿里云 E2B CLI 迁移

标准命令路径以阿里云记录的 `@e2b/cli@2.20.0` 为基线，将其协议客户端固定为 `e2b@2.50.0`，避开已记录的 2.51.0 创建/连接问题。云端范围遵循[阿里云兼容说明](https://help.aliyun.com/zh/agent-sandbox/e2b-compatibility-explanation)。这是 CLI 内部实现，不涉及 Node SDK 发布。

按[安装指南](binary-installation.md)安装当前官方版本。保留现有 `E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`，把可执行文件前缀 `e2b` 改为 `abx`。项目与用户配置文件也可使用。使用阿里云 API Key，不需要 E2B 浏览器登录或 Team 管理。

标准命令的输出选项以各命令帮助为准，例如支持时使用 `--format json`。原生根选项 `--json`／`--quiet` 等不会切换生命周期实现；不支持的组合会明确报错。具体可用选项请查看该标准命令的 `--help`。

```bash
abx sandbox create code-interpreter-v1 --detach
abx sandbox list --format json
abx sandbox exec --cwd /tmp <sandbox-id> sh -c 'printf hello; exit 7'
abx sandbox connect <sandbox-id>
abx sandbox kill <sandbox-id>
abx template list --format json
```

create 位置参数表示模板。未传 `--detach` 时进入真实 PTY；默认生命周期下，退出后请求一秒 TTL；阿里云可能按平台最小租期处理（本次验证账号返回约 60 秒），回收为异步过程，显式 `--timeout`／生命周期选项保留参考版本的寿命语义；connect 进入真实 PTY，退出保留原沙箱。终端状态、stdin、窗口大小、信号、远程退出码遵循固定版本实现。exec 选项放在沙箱 ID 前，之后属于远程命令参数。列表保留状态/metadata 过滤、分页限制和输出格式；kill 支持 ID 与 `--all`。各命令 `--help` 展示固定选项。

自然语言改为 `abx create --prompt "一个 Python 数据分析环境"`，不再占用模板位置参数。`--provider alicloud-express` 保持标准路径；其他安装的 Provider 与项目命令（MCP、config、provider、files、服务端命名命令、template build/deploy）使用项目扩展接口。

Python 导入及行为见[Python 迁移指南](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/guide/migrate-from-e2b.md)。不提供旧版兼容开关。第三方封装中的导入或可执行文件名称由用户在自己的适配器中修改。

暂停/恢复受运行时和白名单限制；快照需要 MicroVM 和已开通账号，并遵循阿里云保留期、名称、占用规则。template list 是阿里云扩展；镜像构建受服务能力和权限约束。官方文档对 Metrics/Logs 有矛盾，不承诺所有账号可用，保留云端错误。Volume、Team、API Key/Access Token 管理、MCP 网关不属于迁移主路径。沿用的命令帮助不能作为云端已支持某功能的证明。OSS/VPC 仍通过扩展使用。

标准命令由项目维护固定版本 MIT 源码，不在运行时依赖或调用外部 E2B。`vendor/e2b-cli/package-lock.json` 固定构建输入，执行 `npm ci --prefix vendor/e2b-cli && npm run vendor:e2b` 可重建。源码清单和许可证随代码保留，npm 与独立二进制均内嵌标准实现。接口测试和真实云端结果在 `.agents/` 记录。

`abx --licenses` 可查看随内嵌标准实现保留的许可证与声明，独立二进制也支持。这不代表整个可执行程序及上游已打包依赖的全量许可证／SBOM 审计已经完成。

`abx template from-image <image> --name <name>` 保留阿里云镜像建模板扩展；`template create` 使用固定 E2B 版本的 Dockerfile 构建语义。


`template init` 保留固定 E2B 版本的本地脚手架行为。Python 同步／异步脚手架导入 `agent_sandbox`；TypeScript 输出保留上游包，因为本次不迁移 Node SDK。模板资源内嵌于独立二进制。项目的 template.yaml／Server 脚手架改为 `template scaffold`，自然语言使用 `--prompt`，已有项目使用 `--adopt`。

在已验证的 python-hello 模板上，后端宣称支持 stdin-close，但 EOF/closeStdin 返回 HTTP 404/unimplemented。真实空管道对照验证中，固定上游 CLI 与 abx 均保留 stdout 并退出 1。这是原有后端不兼容点，迁移时保留同样行为。无需输入时不要创建 stdin 管道；依赖 EOF 的流程需要实现该接口的后端/模板。Python SDK 向固定读取一行的进程发送 stdin 已单独验证。

对当前 python-hello 函数的真实条件探测分别返回 `pauseSession is not enabled for this function` 和 `sandbox runtime does not support snapshot`。客户端接口已实现，成功路径仍需要已启用暂停的函数和合适的 MicroVM 运行时/账号；通用运行时文档不会自动启用已有函数。对应 SDK PR 已记录验证证据。

### 源码安装与产物声明

CLI 使用[安装指南](binary-installation.md)中的当前官方版本，Python 使用 README 指定的配套公开客户端／服务端版本。生成的 Python 模板 README 使用同一个精确运行时依赖；只有开发或主动选择源码安装时才需要检出源码。

`abx --licenses` 包含上游预打包代码的完整依赖身份清单与保留声明。维护者按
[固定源码流程](../../../vendor/e2b-cli/README.md)更新和验证。

### 生成的项目说明

内置极速版 `template scaffold` README 使用显式 Express Provider，以 `template deploy . && create NAME --detach` 串联。在终端中可交互补齐配置，自动化添加 `-y` 前先配置完整。部署失败即停止创建；用输出的 ID 调用命名命令并显式 kill 清理。其他 Provider 给出各自帮助入口，不推荐 Express 部署。AI 重试使用 `create --prompt "DESCRIPTION"`，已有极速版模板使用 `create TEMPLATE --detach`。

原生极速版模板 list/info 使用阿里云 FCSandbox API 和 AccessKey 凭据。原生管理使用 `abx --native template list --region REGION`；标准列表使用 `abx template list --format json` 和 Sandbox API Key。已删除的 `--official-api`/`--legacy-api` 无需传入。发布验收在公开发布前验证当前合同。

维护者发布恢复保持版本不可变：已发布 npm 版本只有与实际验收包完整性相同才允许复用。公开安装读回使用在线元数据和独立缓存，最多重试十分钟后明确失败，不覆盖已发布版本。
