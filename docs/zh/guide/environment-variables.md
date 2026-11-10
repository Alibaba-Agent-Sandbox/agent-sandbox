# 运行环境与认证

宿主配置、创建时环境、单次进程环境和已经运行的应用状态是不同输入。

```bash
abx deploy ./project --name my-app --env MODE=example --yes
abx sandbox exec --env MODE=one my-app -- printenv MODE
abx sandbox exec my-app -- sh -c 'printf "%s\n" "$HOME"'
```

部署选项传入新运行实例。exec 覆盖仅作用于本次进程及其子进程，不会重新配置其他已运行应用。exec 选项放在目标之前：Sandbox 名称或 ID 之后的参数属于远端命令。需要变量展开或管道时显式使用远端 shell，并用引号防止本机提前展开。

模板声明运行时输入。只有已声明的空模型字段继承保存的模型配置，显式值和模板默认值优先。正常应用令牌自动生成并保存。外部客户端使用相同应用令牌，并单独携带 Provider 端点要求的请求头。

检查配置时不要打印秘密。`abx sandbox system env ID` 观察新启动的进程，不是任意现有服务的环境。启用并授权的应用环境 API 影响该应用的后续子进程，不能改变父进程或兄弟进程。启动时已缓存的值可能需要重新部署才能生效。

用 `abx delete my-app --yes` 删除自己创建的实例。连接现有实例不会转移归属。详见[配置](guided-configuration.md)、[模板启动](template-workflows.md)和 [Python 环境指南](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/guide/environment-variables.md)。
