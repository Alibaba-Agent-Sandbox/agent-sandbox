# 部署与构建

可以直接准备并部署资源，也可以先构建再复用：

```bash
abx template init ./project --template python
abx deploy ./project --plan
abx template build ./project --out ./.abx/build.json --yes
abx deploy --build ./.abx/build.json --name my-app --yes
abx status my-app
```

直接 `abx deploy ./project --name my-app --yes` 会合并准备与 Serving 部署。两种路径都不创建动态 Sandbox 实例。template build 准备模板、静态卷并执行 Serving 构建动作；deploy --build 借用已准备资源并部署 Serving。复用期间保留原始源码目录和组件构建文件，内容不能改变。秘密保留在私有配置里，不写进构建记录。

按模板说明使用 run.py 或 SDK 启动业务服务。只创建原生实例时可明确调用：

```bash
abx sandbox create --template TEMPLATE_ID
abx sandbox delete SANDBOX_ID
```

buildConfig 选择 Dockerfile/context 或原生 Steps。Docker 需要本机 daemon、可写仓库及平台拉取权限；Steps 产出模板 ID，详见[资源配置](template-workflows.md)。

```bash
abx delete my-app --yes
abx template build --clean ./.abx/build.json --yes
```

删除清理已确认归属的模板、卷与函数。借用构建在消费者全部删除前保留；显式 retain 卷和镜像 tag 由你继续管理。FC 的 auto 可能创建或复用日志、网络、存储和角色资源，这些可能共享的资源会保留并单独列出，不假定由某个函数独占。

status 显示本地记录。操作结果不确定时，先 recover 观察保存的资源身份，再决定重试或清理；recover 不重放部署动作。本机超时不能证明已提交的云操作停止。超时约束 API 等待与组件子进程，Docker daemon 作业可能需要单独取消。

template publish SOURCE --tag VERSION 发布已提交源码的固定 GitHub 版本，不部署或自动上架。

[编写模板](authoring-templates.md) · [部署和日志](template-launch.md)
