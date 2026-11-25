# 构建与部署

`abx template build SOURCE` 只构建本地 Docker 镜像，不推送镜像、不注册模板、不创建实例，也不执行部署动作。发布资源使用 `abx deploy SOURCE --name NAME`。两个命令之间不需要传递构建文件。

```bash
abx template build ./project --timeout 600
abx deploy ./project --name my-project --yes
abx status my-project
abx delete my-project --yes
```

对于资源规范 `specVersion: 1`，deploy 准备声明的 Sandbox 模板、卷及 Serving 资源。动态实例单独创建：

```bash
abx create --template my-project --resource agent --name my-instance --yes
abx status my-instance
abx delete my-instance --yes
```

仅当项目包含多个 Sandbox 模板时才必须选择 resource。创建实例不会自动启动或配置业务 API 鉴权。配置方法与支持边界见[资源项目](native-resources.md)。

已有 `spec_version: 5` 源码配方保留现有行为：deploy 准备模板，并创建具名实例、启动声明的服务。普通 Dockerfile 可以单独在本地构建；Provider 特定的准备仍在 deploy 中执行。托管应用配方也在 deploy 中准备构建产物。

构建结果区分“已构建本地镜像”“部分本地构建”及“没有本地构建”。原生 Steps 和 Serving actions 在部署阶段执行。本地构建不要求无关的运行时密钥；Dockerfile 和 context 必须填写具体路径。默认平台为 `linux/amd64`；资源 v1 未填写 context 时取 Dockerfile 所在目录。

Delete 删除已确认归属的云资源；已有引用、明确保留的卷、组件管理的共享资源及镜像仓库由原拥有者管理。本地构建结果是普通 Docker 镜像，不再使用时可通过结果中的镜像 ID 用 Docker 删除。部署未完成时使用 `abx recover NAME` 观察已提交操作，该命令不重放发布。

`template publish SOURCE --tag VERSION` 将已提交源码发布为已有 GitHub 仓库的新版本，不部署资源，也不自动创建目录条目。
