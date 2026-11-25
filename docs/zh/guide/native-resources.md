# Sandbox 模板与 Serving 资源

本地 `template.yaml` 使用 `specVersion: 1` 声明可复用的云资源。Deploy 准备 Sandbox 模板、静态卷，并部署 Serving 组件；动态实例另外创建。当前资源适配器支持阿里云极速版及固定版本的 Serverless Devs `fc3` 组件。OpenSandbox 仍可用于实例操作，但没有此 YAML 路径的原生资源适配器。原生组件执行目前需要 npm CLI。

## 完整本地示例

复制[示例目录](../../examples/native-resources/template.yaml)，包含 `guest/Dockerfile`、`guest/hello.py`。将 `sandbox.agent.template.region`、`image` 改为实际地域及可写镜像仓库地址；镜像仓库需要已存在。本地构建需要运行中的 Docker；部署还需要云管理凭据及镜像推送权限。

```yaml
specVersion: 1
name: resource-example
sandbox:
  agent:
    provider: alicloud-express
    template:
      region: cn-hangzhou
      image: registry.example.com/your-namespace/agent:unique-version
      buildConfig:
        dockerfile: guest/Dockerfile
      generation: 2
      cpu: 2
      memorySize: 4096
      diskSize: 15360
      internetAccess: true
```

`vars` 可选，键名由作者定义。本地使用不依赖 `registry.yaml`；目录表单和 API 声明属于发布元数据。`buildConfig` 选择 Dockerfile/context 或原生 Steps。Dockerfile 未配置 context 时，默认使用 Dockerfile 所在目录。`template.image` 在 Dockerfile 模式是推送目标，在 Steps/已有镜像模式是输入镜像；原生 Steps 不会把完成后的 OCI 镜像导出到该地址。

资源项目也可以通过目录源码名称或 `OWNER/REPO//DIRECTORY@COMMIT` 获取。需要可重复的源码时使用完整 commit SHA：分支或默认引用会复用已有本机源码缓存，不保证每次拉取远端最新内容。`template init --from REF` 只复制源码供修改；获取之后的 build、deploy 仍会校验资源契约。

```bash
abx template build .
abx deploy . --name tools --plan
abx deploy . --name tools --yes
abx status tools
abx create --template tools --resource agent --name work --timeout 300 --yes
abx status work
abx delete work --yes
abx delete tools --yes
```

Build 返回本地镜像 ID，不注册云模板、不执行 hook，也不读取无关的运行时密钥。Dockerfile/context 必须填写具体路径。只有输入内容身份和 Docker 镜像 ID 都确认一致才复用缓存。Steps 和 Serving actions 会注明推迟到部署；`no_local_build` 不代表它们已部署。`--timeout` 限制本地镜像构建；`deploy --build-timeout` 用于资源准备。

`tools` 是资源部署名，`work` 是动态实例名。只有一个 Sandbox 模板时可省略 `--resource`。也可用 `abx create --template ID` 指定原生模板 ID。实例环境变量及挂载在 create 时传入，例如 `--env MODE=demo --volume-mount /workspace=my-volume`。

具名模板选择使用已记录的 Provider、原生模板 ID、地域、Team 和 endpoint。管理凭据必须属于记录的账号；托管运行时 Key 路径接收选定的 Team。手动配置的 Sandbox API Key 是另一种凭据，必须有权限访问该 Team 和模板；管理账号检查不会验证一个不透明运行时 Key 的拥有者。

## Serving 与资源依赖

Serving 保留组件原生 props 及命令动作：

```yaml
specVersion: 1
name: serving-example
serving:
  api:
    component: serverless-devs/fc3@0.1.26
    props:
      region: cn-hangzhou
      functionName: serving-example
      runtime: nodejs20
      code: ./server
      handler: index.handler
      memorySize: 512
      timeout: 30
```

部署前需要提供 FC 组件所要求的实际 `server` 源码。此例创建函数；HTTP 触发器、域名及业务 API 仍须通过原生 props 和应用代码配置。组件版本必须固定。删除函数时保留组件管理的共享 `auto` 依赖资源。

Sandbox 和 Serving 均可包含多个具名资源，逻辑名全局唯一。`${vars.key}`、`${env('KEY')}` 在 deploy 中由官方 Devs 解析器解析。`${resources.agent.output.templateId}` 引用已就绪模板的原生 ID，并建立部署顺序。不存在的依赖和循环依赖会被拒绝。每个资源支持 `pre-deploy`、`success-deploy`、`fail-deploy`、`complete-deploy`；它们在部署发起端运行，不是动态实例启动钩子。

## 就绪与清理

`status` 查询已记录的原生 ID，将当前云状态和原有部署结果分开显示。鉴权和网络失败不代表资源不存在。`recover NAME` 观察中断操作，不重放发布。结果不确定的镜像推送会保留未解决状态；检查报告的目标后，再清理或使用新 tag 部署。

Delete 删除确认归属的模板、卷和函数。借用资源、保留卷、组件共享依赖和镜像目标仍由原拥有者管理。删除资源模板不会删除另外创建的动态实例。本地镜像 ID 可用 Docker 管理。

创建 Sandbox 不会自动启动业务 HTTP 服务、注入应用凭据、绑定 OpenAPI 或部署 Agents API Gateway。Express `startCommand`/`readyCommand` 仍表示模板构建和快照阶段的原生含义。已有 `spec_version: 5` 源码部署保留声明的服务启动流程，见[构建与部署](deploy-and-build.md)。
