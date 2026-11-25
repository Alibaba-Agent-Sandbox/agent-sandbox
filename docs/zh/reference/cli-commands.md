# CLI 命令

`abx` 用于部署可复用模板、管理运行实例，以及使用 Sandbox 能力。以下命令对应当前源码；使用这套入口须安装由本次源码构建的 CLI。已发布的 0.5.10 使用此前的命令布局。

<!-- fixed-set -->

`abx deploy`, `abx list`, `abx status`, `abx logs`, `abx delete`, `abx recover`, `abx template`, `abx sandbox`, `abx config`, `abx provider`, `abx mcp`, `abx exec`, `abx connect`, `abx upload`, `abx download`, `abx capabilities`, `abx files`, `abx process`, `abx system`, `abx pause`, `abx resume`, `abx metrics`, `abx snapshot`, `abx fork`, `abx network`.

## 部署与管理

```bash
abx config init
abx deploy python-hello --name demo
abx status demo
abx logs demo
abx delete demo
```

`deploy SOURCE` 接受目录名称、Registry 源码引用或本地模板目录。`--name` 设置独立于模板的实例名称，省略时使用模板名。`--plan` 校验源码并预览所需资源，不构建或部署。自动化使用 `--yes` 授权变更；JSON 输出不代表授权。

已有 Provider 原生模板可使用 `deploy --template-id ID`，无需准备源码。`--sandbox-timeout` 控制 Sandbox 租期，`--build-timeout` 控制模板准备期限，`exec --timeout` 控制单条命令。Express 还支持 `--on-timeout pause --auto-resume`。`--env`、`--metadata`、`--volume-mount`、`--upload` 配置 Sandbox 实例。

托管应用同样使用 `deploy`，通过 `--bindings FILE` 提供外部服务及凭据引用。对已就绪应用使用相同名称部署会更新应用，并保留仍有会话使用的版本。普通 Sandbox 部署需先删除，再使用相同名称创建。资源已删除的名称可以复用。

`list` 汇总本机部署记录和所选 Provider 的 Sandbox。`--local` 不查询云端；`--all-providers` 查询所有已配置 Provider；`--limit`、`--offset`、`--status` 控制远端 Sandbox 结果。本机记录状态与远端观察分别标明。

`status`、`logs`、`delete` 也接受原生 Sandbox ID；同名本机部署优先，可通过带 Provider 前缀的 ID 明确访问原生资源。`status --revisions` 展示应用保留版本；`delete NAME --revision REVISION` 退役不再使用的版本。

具名 Sandbox 的 `logs` 读取模板服务启动日志；`--source platform` 读取原生 Sandbox 日志。托管应用通过 `logs --role gateway|worker|dispatcher` 查询相应函数已配置的 FC 日志目的地，目前支持单次查询，需要预先启用该函数的日志配置。

`recover NAME` 根据保留的归属记录观察中断结果，不重放结果不确定的创建或发布请求。根据输出处理后再部署或删除。本机记录位于 `~/.abx/deployments`，资源存在期间请保留；本机部署锁不协调多台机器的并发部署。

删除部署会清理其记录的自有资源。外部服务和显式复用的构建产物仍由原拥有者管理；结果会列出需要手动处理的保留镜像，不再使用时通过对应镜像仓库的管理工具删除。

## 模板创作

```bash
abx template list python
abx template info python-hello
abx template init ./my-template --from python-hello
abx template init ./my-mcp --template mcp
abx template build ./my-template --yes
abx deploy --build BUILD_FILE --name demo --yes
abx template publish ./my-template --tag v1.0.0 --yes
abx template build --clean BUILD_FILE --yes
```

`list`、`info` 查询可复用模板目录；原生云模板通过 Provider 操作查询。

`init --from` 只复制源码，不执行部署校验、镜像构建或资源创建。`init --template` 生成本地骨架，`--prompt` 和 `--adopt` 用于辅助创作。生成内容均可修改。

`build` 准备与 Provider 关联的可复用产物，并保留源码快照和资源记录，可能执行收费的远端构建。输出给出产物文件路径。`deploy --build` 校验源码与目标后复用准备好的引用；原生引用的可变性由 Provider 决定，不将其称为通用不可变镜像格式。仍被部署使用的构建不能清理。托管应用构建另外固定镜像摘要与组件工具链。

`publish` 将已提交的源码版本推送到已有 GitHub remote 的新标签，返回固定 commit 的 Registry 源码引用，不自动加入模板目录。内容变化请使用新版本标签，命令不会覆盖远端既有标签。

## Sandbox 操作

`abx sandbox TARGET --help` 列出本地已绑定 OpenAPI 契约中的操作；`abx sandbox TARGET OPERATION --help` 展示参数、请求体、响应和认证要求。通过 `abx sandbox TARGET OPERATION --body @request.json` 调用。TARGET 必须是已有 Sandbox ID 或本地沙箱部署名称；多个 API 有同名操作时使用 `--api NAME` 消歧。

声明的标量输入会生成 `--path-id VALUE`、`--query-limit VALUE`、`--body-message VALUE` 等选项；名称无歧义时可以简写为 `--id`、`--message`。操作帮助展示实际选项和客户端支持范围。完整 JSON 保留 `--body @request.json`，管道输入使用 `--body -`；`--output FILE` 将原始响应字节保存到一个新文件，错误响应不生成文件。重复请求体以及完整请求体与字段选项混用，会在调用服务前报错。

模板的 `registry.yaml.apis` 只描述一个 Sandbox 资源时，部署成功会自动绑定。已有实例或没有 API 声明的模板，可先绑定本地 registry。绑定只描述已有服务，不安装或启动服务。完整示例、别名、凭据来源与 OpenAPI 支持范围见 [Sandbox API 操作](../guide/sandbox-api.md)。

平台和运行环境工具使用根命令：`exec`、`connect`、`upload`、`download`、`files`、`process`、`system`、`capabilities`、`pause`、`resume`、`metrics`、`snapshot`、`fork`、`network`。能否使用取决于 Provider 和已安装的服务。

```bash
abx exec demo -- python -c 'print("hello")'
abx files list demo /home/user
abx connect demo

# 已有服务及其 registry：
abx sandbox demo --bind ./registry.yaml
abx sandbox demo --help
abx sandbox demo report_totals --body @request.json
```

旧的 `sandbox command list/run` 包装入口已移除。SDK 注册函数的路由及装饰器继续遵循各自契约。发现操作或拥有规范文件不代表获得服务调用权限。

## 配置、Provider 与 MCP

`config init/get/set/list/delete` 管理凭据、Provider 配置与默认值。交互输入默认保存到当前用户；命令选项和环境变量用于临时覆盖。

`provider list/info/install/update/uninstall/doctor` 管理插件；`provider run OPERATION` 是原生操作的唯一执行入口。`provider command list/info` 保留机器可读的操作说明和输入 Schema。SDK 使用的 engine 与 Provider contract test 仍作为开发者工具提供。具体输入查看对应操作的 `--help`。

`mcp install/start/status/stop` 管理本机 MCP 接入。HTTP MCP 服务使用 `template init --template mcp` 创建可编辑源码，再按模板部署。

所有命令共用 `--json`、`--quiet`、`--verbose`、`--no-color`、`--ci` 和同一解析入口。流式操作按其说明输出数据流；Provider 选择不会切换解析器。每条命令的 `--help` 提供实际选项清单。
