# 部署与构建

源码编写、准备构建、部署运行和发布源码版本分别有独立用途：

```bash
abx template init ./project --template python
abx template build ./project --out ./.abx/build.json --yes
abx deploy --build ./.abx/build.json --name my-app --yes
abx status my-app
abx delete my-app --yes
abx template build --clean ./.abx/build.json --yes
```

不需要单独复用构建时，直接 `abx deploy ./project --name my-app`。`template build` 不启动实例；`deploy --build` 的参数是构建文件，不是构建模式。Dockerfile 或受支持的平台步骤由模板声明与 Provider 准备路径决定；`--build-profile` 只选择清单中明确声明的配置，不静默切换。

Docker 构建需要可用的本机 Docker 与可写镜像仓库，运行平台必须能拉取镜像。平台步骤的运行时、文件输入与权限限制依所选 Provider。部署本身不调用模型；需要模型的是 `template init --prompt` 或 `--adopt`。

部署删除仅清理记录中属于该部署的资源。单独构建会保留供复用；清理前应删除使用它的应用，清理结果会列出仍需手动处理的镜像。失败后先 `abx status APP` 和 `abx recover APP`，不要盲目重复创建。

`template publish SOURCE --tag VERSION` 发布已提交的源码到现有 GitHub remote 的不可变版本，并返回固定提交引用；它不部署应用，也不自动添加公共目录条目。

[完整模板编写指南](authoring-templates.md) · [部署与故障边界](template-launch.md)
