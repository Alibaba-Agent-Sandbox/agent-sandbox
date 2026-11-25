# 部署与构建

初始化可编辑源码，按应用名称部署，再通过同一名称管理：

```bash
abx template init ./project --template python
abx deploy ./project --name my-app --yes
abx status my-app
abx delete my-app --yes
```

`deploy` 准备所需模板并启动部署。Dockerfile 或受支持的平台步骤由模板声明与 Provider 准备路径决定；`--build-profile` 只选择清单中明确声明的配置，不静默切换。

Docker 构建需要可用的本机 Docker 与可写镜像仓库，运行平台必须能拉取镜像。平台步骤的运行时、文件输入与权限限制依所选 Provider。部署本身不调用模型；需要模型的是 `template init --prompt` 或 `--adopt`。

部署删除仅清理记录中属于该部署的资源，请按输出中的资源保留或镜像清理指引操作。失败后先 `abx status APP` 和 `abx recover APP`，不要盲目重复创建。

`template publish SOURCE --tag VERSION` 发布已提交的源码到现有 GitHub remote 的不可变版本，并返回固定提交引用；它不部署应用，也不自动添加公共目录条目。

[完整模板编写指南](authoring-templates.md) · [部署与故障边界](template-launch.md)
