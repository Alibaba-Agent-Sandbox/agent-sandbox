# CLI 命令

`abx` 用于部署可复用模板、管理运行实例，以及使用 Sandbox 能力。以下命令对应当前源码；使用这套入口须安装由本次源码构建的 CLI。已发布的 0.5.10 使用此前的命令布局。

<!-- fixed-set -->

`abx deploy`、`abx list`、`abx status`、`abx logs`、`abx delete`、`abx recover`、`abx template`、`abx sandbox`、`abx config`、`abx provider`、`abx mcp`。

## 部署与管理

```bash
abx config init
abx deploy python-hello --name demo --yes
abx status demo
abx delete demo --yes
```

`deploy SOURCE` 接受目录名称、Registry 源码引用或本地模板目录。`--name` 设置资源部署名称，省略时使用模板名。`--plan` 校验源码并预览所需资源，不构建或部署。自动化使用 `--yes` 授权变更；JSON 输出不代表授权。

`sandbox create --template ID --timeout 600 --yes` 使用已有原生模板创建动态实例。`--env`、`--metadata`、`--volume-mount` 属于该创建命令，文件使用 `sandbox upload` 上传。deploy 的 `--build-timeout` 控制资源准备期限，`sandbox exec --timeout` 控制单次命令。

Serving 使用 `serving.<名称>.props` 声明组件原生配置。外部服务和凭据通过私有环境引用，应用运行行为由业务代码与 SDK 管理。

`list` 汇总本机部署记录和所选 Provider 的 Sandbox。`--local` 不查询云端；`--all-providers` 查询所有已配置 Provider；`--limit`、`--offset`、`--status` 控制远端 Sandbox 结果。本机记录状态与远端观察分别标明。

`status`、`logs`、`delete` 也接受原生 Sandbox ID；同名本机部署优先，可通过带 Provider 前缀的 ID 明确访问原生资源。`status --revisions` 展示应用保留版本；`delete NAME --revision REVISION` 退役不再使用的版本。

`logs NAME --resource SERVING_NAME` 读取所选 Serving 的 FC 日志；动态实例使用其 Sandbox ID 读取日志，函数须已配置日志投递。

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

专属能力包括 `sandbox exec`、`sandbox connect`、`sandbox files`、`sandbox process`、`sandbox command`、`sandbox system`、`sandbox capabilities`、`sandbox pause`、`sandbox resume`、`sandbox metrics`、`sandbox snapshot`、`sandbox fork`、`sandbox network`。可传具名 Sandbox 部署或原生 ID；高级操作取决于 Provider 的实际支持。

```bash
abx sandbox exec demo -- python -c 'print("hello")'
abx sandbox files list demo /home/user
abx sandbox command list demo
abx sandbox connect demo
```

## 配置、Provider 与 MCP

`config init/get/set/list/delete` 管理凭据、Provider 配置与默认值。交互输入默认保存到当前用户；命令选项和环境变量用于临时覆盖。

`provider list/info/install/update/uninstall/doctor` 管理插件；`provider run OPERATION` 是原生操作的唯一执行入口。`provider command list/info` 保留机器可读的操作说明和输入 Schema。SDK 使用的 engine 与 Provider contract test 仍作为开发者工具提供。具体输入查看对应操作的 `--help`。

`mcp install/start/status/stop` 管理本机 MCP 接入。HTTP MCP 服务使用 `template init --template mcp` 创建可编辑源码，再按模板部署。

所有命令共用 `--json`、`--quiet`、`--verbose`、`--no-color`、`--ci` 和同一解析入口。流式操作按其说明输出数据流；Provider 选择不会切换解析器。每条命令的 `--help` 提供实际选项清单。
