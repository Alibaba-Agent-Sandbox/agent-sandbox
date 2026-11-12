# 构建可复用模板

`template build` 准备源码产物，不启动实例。`deploy --build FILE` 使用该产物，`--build` 表示产物文件。直接部署则准备源码并创建具名应用。

```bash
abx template build ./project --out .abx/build.json --timeout 600 --yes
abx deploy --build .abx/build.json --name my-app --yes
abx template build --clean .abx/build.json --yes
```

模板 v1 在 `sandbox.template.source` 选择 Dockerfile。当前 CLI 源码适配器要求根目录 Dockerfile 和 `context: .`。显式 profile 选择已声明的另一个 Dockerfile，准备失败不会改用其他配方。Provider 原生平台步骤仍是独立 Provider 能力，不属于 v1 源码生成路径。

```yaml
sandbox:
  template:
    source:
      dockerfile: Dockerfile
      context: .
      profiles:
        portable:
          dockerfile: Dockerfile.portable
          context: .
```

准备过程会等待就绪。构建的 `--timeout` 和部署的 `--build-timeout` 接受大于零、不超过3600秒的预算，默认600秒；`--sandbox-timeout` 覆盖实例期限。本地超时不代表远端工作已停止。保留恢复记录，通过 status/recover/delete 管理具名部署。单独构建的产物需先移除全部使用者才能清理。私有环境配置不会复制进构建快照；请保留原始配置来源，以便后续部署和恢复。参见[模板创作](../guide/authoring-templates.md)和[托管应用](../guide/managed-applications.md)。
