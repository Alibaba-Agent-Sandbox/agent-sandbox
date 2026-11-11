# 使用模板

`template list` 和 `template info` 查看公共目录，不是云账号中的原生模板列表。选择源码或托管目录条目后，部署一个具名实例：

```bash
abx template list python
abx template info python-hello
abx deploy python-hello --name hello --yes
abx status hello
```

需要定制时，先获取可编辑源码。`init --from` 只复制文件，不解释部署规范；能获取未来版本的清单不等于当前 CLI 能部署它。

```bash
abx template init ./hello --from Alibaba-Agent-Sandbox/awesome-templates//python-hello
abx deploy ./hello --name hello-custom --yes
```

Git 引用支持 `owner/repository//subdirectory@COMMIT`。固定提交可复现输入。私有 GitHub 源码通过 `abx config set github_token` 隐藏输入凭据，自动化使用 `GITHUB_TOKEN`。获取源码不会构建镜像或创建云资源。没有源码的托管目录条目可以直接部署，但不能复制为可编辑工程。

Sandbox 应用通过清单声明服务。用 `abx sandbox command list hello` 发现 Server 命令，通过 `abx sandbox command run hello COMMAND` 调用，用 `abx delete hello --yes` 删除拥有的资源。托管应用使用自身业务 HTTP API，见[托管应用](managed-applications.md)。

[编写、复用构建与 Git 发布](authoring-templates.md) · [启动与清理](template-launch.md)
