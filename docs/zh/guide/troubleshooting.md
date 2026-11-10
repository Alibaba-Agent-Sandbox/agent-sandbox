# 故障排查

先确认 `abx --version`、所选 Provider 与错误发生的阶段。当前源码的命令见[操作速查](operations.md)，旧安装版使用其 `--help`。

## 配置与认证

运行 `abx config list` 查看有效配置，敏感值应隐藏输入：`abx config set sandbox_api_key`。检查 API Key、地域和端点是否属于同一 Provider。Sandbox Key、云 AccessKey、应用令牌和模型 Key 用途不同，见[配置引导](guided-configuration.md)。401/403 不是资源不存在；不要用其他 Provider 的密钥重试。云管理 Key 的创建或续期保留独立确认。

## 模板与源码

`abx template list` 搜索公共目录，`abx template init ./project --from SOURCE` 获取源码，`abx deploy ./project --name APP` 部署。缺少工程时先初始化，不让部署猜测要生成的内容。未知规范可以复制保存，但部署仍需支持的清单；Sandbox 与托管应用的限制见[模板启动](template-workflows.md)。GitHub 限流用 `abx config set github_token` 隐藏输入；固定 Git 提交不会因刷新目录缓存而改变。

## 模型生成

只有 `template init --prompt` 和 `--adopt` 需要模型。用 `abx config set llm_api_key`、`llm_base_url` 和 `llm_model` 配置可用的模型端点。模型拒绝时可用 `--model ID` 覆盖本次生成。生成失败先检查保留的工程，不能把失败生成当作已部署应用。非交互适配现有代码需要明确 `--yes`；`--dry-run` 可先查看文件范围。

## 构建与网络

Dockerfile 构建需要本机 Docker 可执行文件、可访问 daemon 和正确 context；先运行 `docker info`。检查构建容器内的包源、DNS、HTTPS、CA、代理和 MTU。宿主可以下载不代表容器网络正常。不要关闭 TLS 或改版本掩盖网络错误。镜像仓库需要写入权限，运行平台也要能拉取镜像。

准备期限使用 `deploy --build-timeout` 或 `template build --timeout`。增加等待时间不保证远端任务取消，超时后先查看状态。`--verbose` 提供本机诊断，应用或构建脚本打印的日志可能含敏感内容。

## 部署失败与清理

```bash
abx status APP
abx recover APP
abx delete APP --yes
```

recover 观察已保存的资源归属，不重放创建或发布。已知不存在与鉴权/网络失败需要区分；清理未确认时保留本机记录。独立构建通过 `template build --clean BUILD_FILE --yes` 清理，使用它的应用必须先删除。手动保留的镜像按输出处理。只删除本轮拥有的资源，不使用全账号批量清理代替归属判断。

## 命令和文件

`abx sandbox exec APP -- COMMAND` 调用进程，`abx sandbox command run APP NAME` 调用已部署的应用注册函数；两者不是同一协议。函数缺失时先 `abx sandbox command list APP`。文件错误检查实际路径、运行用户和权限；不要假设容器中所有文件都属于服务用户。连接托管应用时使用其业务 HTTP API，不能把应用名称当作一个 Sandbox ID。

## 安装

找不到 abx、下载或 npm 安装失败时，按[安装指南](binary-installation.md)核对 PATH、系统架构及实际发行物。不要从历史错误日志推断当前 npm 或二进制是否可用。
