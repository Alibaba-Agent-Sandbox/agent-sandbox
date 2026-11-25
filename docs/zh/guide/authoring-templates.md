# 编写模板

模板是可复用的源码；部署模板会创建一个单独管理的命名应用。
模板命令为 `template list`、`info`、`init`、`build` 和 `publish`。

## 查找或创建源码

```bash
abx template list python
abx template info python-hello
abx template init ./my-template --template python
abx template init ./my-copy --from owner/repo//template@COMMIT
abx template init ./my-mcp --template mcp
```

内置案例包括 `python`、`node`、`minimal` 和 `mcp`，可用 `template init --list`
查看。`--from` 复制目录条目、仓库或本机模板的源码，不构建、不注册、不部署。
即使当前 CLI 不支持执行某个新版本清单，也可以先取得源码再编辑。
只有托管标识、没有源码的目录条目可以部署，但不能通过 `--from` 复制。

项目包含 `template.yaml` 及源码，常见文件为 Dockerfile、应用入口和 README。
清单声明服务、启动方式、就绪检查、资源默认值及运行时环境输入。
所选 Provider 的镜像配置决定基础镜像和平台启动规则。
API Key 和应用令牌应保留在源码之外。

覆盖前会显示已有文件；交互替换需要确认，自动化必须明确使用 `--force`。
单独 `--yes` 不授权覆盖已有文件。

## 生成或改造应用代码

```bash
abx template init ./my-template --prompt "一个 Python 数据分析服务"
abx template init --adopt ./app --hint "API 监听 8080 端口"
abx template init --adopt ./app --dry-run
```

生成使用已配置的 Coding 模型。`--prompt` 发送描述；`--adopt` 在确认后发送已检查的
项目副本。`--dry-run` 只显示候选文件，不调用模型、不写入项目。
非交互生成需要 `--yes`。

改造只回写 Dockerfile、commands.py、template.yaml，以及原本不存在的
.dockerignore；其他生成修改会丢弃。替换文件保留带编号的 `.abx-bak` 备份。
已有模板或用途不同的 commands.py 需要 `--force`。源码副本检查排除密钥、符号链接、
大文件、二进制和依赖目录；已有 Docker ignore 规则必须排除密钥。
生成后仍应检查文件，再构建或部署。

## 构建与部署

```bash
abx template build ./my-template
abx deploy ./my-template --name my-app --yes
abx status my-app
```

Build 只准备本地 Docker 镜像。Deploy 发布所选源码；资源 v1 会自动复用输入一致且已验证的本地镜像。原生 Steps 和 Serving actions 在部署阶段执行。两种配置的具体流程见[构建与部署](deploy-and-build.md)。

## 发布可复用源码

先把模板提交到已有 GitHub HTTPS 或 SSH remote 的仓库：

```bash
git add template.yaml Dockerfile commands.py README.md
git commit -m "feat: add analysis template"
abx template publish . --tag v1.0.0 --yes
```

发布把干净、已提交的源码推送为新标签，并返回固定到提交 SHA 的引用。
它不创建目录收录，也不启动应用。远端标签已经指向其他提交时会拒绝替换，须使用新版本。
`--remote NAME` 选择已有 remote。Git 使用你配置的认证，remote URL 不应嵌入凭据。

其他用户可以通过 `template init --from REFERENCE` 复制返回的源码引用，
或用 `abx deploy REFERENCE --name APP` 部署。目录收录遵循
[模板仓库贡献指南](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/CONTRIBUTING.md)。

## 资源清理

使用 `abx delete NAME --yes` 删除部署中已确认归属的资源。操作中断后使用 `abx recover NAME`。已有外部服务、保留资源和镜像仓库仍由原拥有者管理。本地构建镜像不再使用时可以通过 Docker 删除。
