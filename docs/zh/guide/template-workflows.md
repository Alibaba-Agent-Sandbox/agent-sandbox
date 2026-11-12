# 启动 Sandbox 模板

运行 `abx --provider PROVIDER deploy TEMPLATE --name my-app --yes`。Sandbox 模板只有一个启动流程：准备源码、创建实例、运行 `sandbox.start`、等待 `sandbox.ready`，再解析 `sandbox.services` 中的全部访问地址。业务命令在启动后由用户调用。

使用 `specVersion: 1` 和一个本地 `template.yaml`。源码放在 `sandbox.template.source`，已有镜像使用 `sandbox.template.image`，Provider 原生模板使用 `sandbox.provider` 与 `sandbox.template.reference`。镜像引用需要固定的 `@sha256:` 摘要。镜像依赖与启动文件随项目保存；实例的期限、环境变量、标签及所选 Provider 支持的资源参数放在 `sandbox.instance`。

```yaml
specVersion: 1
name: example
sandbox:
  template:
    source: {dockerfile: Dockerfile, context: .}
    props: {cpu: 2, memory: 2048}
  instance:
    timeout: 300
    envs: {ABX_SERVER_TOKEN: ""}
  start: python3 commands.py
  services:
    app: {protocol: agent-sandbox-server, version: 2, port: 9000, operations: [commands.list, commands.run]}
```

缺少应用认证令牌时，CLI 自动生成并安全保存在本机。Provider 的流量认证是另一层凭据。完整字段及 Provider 边界见[模板 v1 规范](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.md)。本地使用不要求 `registry.yaml`；上架时才在该文件填写目录元数据和初始化问题。

公开目录中的原生模板可直接按名称部署，例如 `abx --provider alicloud-express deploy base --name my-app --yes`。托管 Agents 使用独立的[应用生命周期](managed-applications.md)。CLI 可以解析通用原生 Serving 项目，但暂不支持其部署和删除生命周期；没有受支持应用类型的 Sandbox/Serving 混合项目会在创建资源前停止。

旧公开 YAML 需要按资源结构迁移到 v1，仅修改版本字段并不够。请选择当前源码版本；刷新目录不会刷新已下载源码，也不会改变固定 Git revision。CLI 不会自动改写或删除源文件。
