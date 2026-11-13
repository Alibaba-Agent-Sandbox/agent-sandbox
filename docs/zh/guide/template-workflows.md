# 模板资源配置

`template.yaml` 声明命名的 Sandbox 模板、静态卷与 Serving。部署准备这些资源；动态沙箱实例由业务代码或明确的 SDK/CLI 调用创建。

```yaml
specVersion: 1
name: demo
vars:
  region: cn-hangzhou
sandbox:
  agent:
    provider: alicloud-express
    template:
      region: "${vars.region}"
      image: registry.example.com/team/agent:v1
      buildConfig:
        dockerfile: ./sandbox/Dockerfile
serving:
  api:
    component: serverless-devs/fc3@0.1.26
    props:
      region: "${vars.region}"
      functionName: demo-api
      runtime: custom-container
      customContainerConfig:
        image: registry.example.com/team/api:v1
        port: 9000
      environmentVariables:
        SANDBOX_TEMPLATE_ID: "${resources.agent.output.templateId}"
```

示例仓库地址需换成已有镜像或可写的构建目标。`vars` 可选，键名由作者自行决定，也可以直接在资源属性里填写值。目录初始化表单放在 `registry.yaml.parameters`，之后修改本地配置不依赖目录文件。

地域保留在 `sandbox.名称.template.region`，同级卷使用该地域。Express 模板属性保持扁平结构。`buildConfig` 选择 `dockerfile` 加可选 `context`，或者原生 `steps`，不能混用。路径相对 `template.yaml`；context 省略时采用 Dockerfile 所在目录。没有 buildConfig 时不会自动发现本机 Dockerfile。

Dockerfile 分支的 `image` 是构建推送目标；其他分支的 image 是已有来源镜像，Steps 在此基础上准备沙箱模板，不承诺导出 OCI 镜像。无需认证、证书或仓库网络覆盖时省略整个 `registryConfig`。软件安装放在 Dockerfile 或基础镜像里。原生 `startCommand`、`readyCommand` 在模板准备阶段执行，不代表每次动态实例创建后的启动钩子。

Serving 保留组件原生 `props`。需要构建 Serving 时，通过资源自己的 `actions.pre-deploy` 声明 `component: serverless-devs/fc3@0.1.26 build ...`。Shell run 和组件动作都在部署发起端执行。`success-deploy` 在该资源就绪后执行，`fail-deploy` 处理失败，`complete-deploy` 在结束时执行。输出引用决定依赖顺序，缺失引用和循环在部署前报错。新部署尝试可能再次运行动作，脚本应能处理重试。

命名资源执行器当前支持 Express 和精确版本的 `serverless-devs/fc3`。其他 Provider 的实例 API 独立可用。应用令牌、数据库、模型与动态实例环境由应用自身配置，不增加通用模板字段。秘密通过私有环境或文件引用提供。Agents API 模板提供自己的启动和发布脚本，请按对应 README 使用。

[构建与部署](deploy-and-build.md) · [原生表达式](../design/template-v1-parser.md) · [完整字段参考](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.md)
