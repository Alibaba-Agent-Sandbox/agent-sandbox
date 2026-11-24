# 使用 Sandbox 模板

以下命令适用于[当前源码构建的 CLI](binary-installation.md)。已发布的 0.5.10 使用此前的命令布局。

## 从 Registry 构建并创建沙箱

`template list` 和 `template info` 查看公共目录。先配置所选 Provider 的运行和构建凭据。极速版使用 Docker 构建时还需要一个可推送镜像的仓库。`python-hello` 无需模型凭据。[配置和权限](permissions.md)

```bash
abx config init
abx template list python
abx template info python-hello
abx template build python-hello --out .abx/hello-build.json --yes
abx create --build .abx/hello-build.json --name hello --sandbox-timeout 600 --yes
abx status hello
abx sandbox command list hello
abx sandbox command run hello hello --arg name=Ada
```

构建准备可复用模板，不创建实例。创建会按构建记录启动沙箱和模板中声明的服务，并检查就绪状态。调用结果为 `Hello, Ada!`。再次创建时，可复用同一个构建文件并使用新的实例名。

删除所有使用该构建的实例后，再清理构建：

```bash
abx delete hello --yes
abx template build --clean .abx/hello-build.json --yes
```

构建清理会列出仍需手动移除的镜像。在仓库中删除它们之前，先确认没有其他使用方。[创建和清理细节](template-launch.md)

## 复制模板并定制

```bash
abx template init ./hello --from python-hello
# 修改 ./hello 项目的文件。
abx template build ./hello --out .abx/hello-custom-build.json --yes
abx create --build .abx/hello-custom-build.json --name hello-custom --yes
```

`init --from` 只复制源码，包括当前 CLI 可能还不支持执行的清单。使用 `owner/repository//subdirectory@COMMIT` 固定 Git 输入。私有 GitHub 源码可用 `abx config set github_token` 隐藏输入凭据，自动化可注入 `GITHUB_TOKEN`。

## 使用已有的原生模板

用 `abx --json template info base` 查看 Provider 管理的目录模板。结果中 `source: null`，已有模板的 Provider 和 ID 分别在 `manifest.provider` 和 `manifest.template_id`。以极速版的 `base` 为例：

```bash
abx --provider alicloud-express create --template-id base --name base-demo --yes
abx --provider alicloud-express delete base-demo --yes
```

从原生 ID 创建时借用 Provider 已有的模板，删除实例后模板仍然可用。使用 FC 部署对外提供业务 HTTP API 的应用，请参阅[托管应用](managed-applications.md)。
