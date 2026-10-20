# 单一模板中的 Agent 应用

本预览只使用一个 `template.yaml`。原有 sandbox 字段保留在根，可选
`application` 区块描述 Agent 位置、部署和 hooks。规范由
[awesome-templates](https://github.com/Alibaba-Agent-Sandbox/awesome-templates) 维护；
CLI 内置 v3 schema 摘要为 `afaa4a30fd24a5c5e4f4e28465d421e7076e612ab75e20c1a33c1d582c385a50`。
v2/未声明版本的旧模板保持现有行为；未知版本、v2 携带 application 会明确拒绝。
普通安装、创建 sandbox 不执行应用 hooks。

## 两种运行位置

- `in-sandbox` + `sandbox-local-api`：Agent/CLI 在 sandbox 内执行。客户端直连保持轻量；
  应用 apply 准备模板并返回提供方的准确引用，不创建外部数据库或网关。
- `external` + `python-remote-tools`：可信 Python Agent 循环在外部执行，生成代码和文件工具
  操作远程 sandbox。FC Web 网关、Task Worker 和有界 dispatcher 共用持久 PostgreSQL。

网关在外面不代表 Agent 在外面；把 coding CLI 装到 FC 也不会自动绑定远程工具。
运行时、客户端、factory、鉴权和本地集成步骤见
[Python SDK](https://github.com/Alibaba-Agent-Sandbox/python-sdk)。

## 显式部署流程

先构建、审查容器，以镜像摘要固定 FC 工件。FC 部署设置
`application.deployment.adapter: serverless-devs-fc3`，在 `inline` 和 `project` 中选一个。
`inline` 将 Serverless Devs v3 描述放在模板内，CLI 将冻结计划和回执写入 `.abx/app/`，
在隔离临时目录中生成并执行 s 项目；
普通用户不必再维护一份 YAML。复杂场景才使用指向经审查本地 s 项目的 `project`。

```sh
abx app plan ./template.yaml
abx app apply PLAN_FILE --yes
abx app status RECEIPT_FILE
abx app reconcile RECEIPT_FILE --yes
abx app plan --destroy RECEIPT_FILE
abx app destroy DESTROY_PLAN_FILE --yes
```

使用命令返回的实际计划和回执路径。plan 完全离线，不运行 hook、提供方构建、s 或云 API。
计划绑定源码并在一小时后过期；生成文件须放入 `.abx/` 或源码目录外。
status 读取本地回执；reconcile 查询远端并可重复已审查的 afterReady 探测，不重放部署。
本地锁不能覆盖多个 CI 主机，共享部署需外部锁及独占的版本命名空间。

FC 预检解析一个明确的 Serverless Devs 凭据配置，原生检查和 s 共用同一 AK/STS 快照。
以原子 CreateFunction 拒绝同名既有函数，立即保存返回的原生资源身份；
s 随后只部署触发器和异步调用配置：`deploy --trigger --async-invoke-config`，不更新函数主体。
更新使用新的 revision 函数名；本预览不承诺生产别名的原子切换。

ready 需要账号/名称/资源实例身份一致、镜像摘要一致、Active 状态、已报告的更新状态成功，
以及网关协议/revision 探测与 afterReady hooks 通过。回执保存原生 ID、创建时间、
资源范围和不确定状态，不保存原始 s info 或凭据。销毁需要独立计划，并确认资源确实消失。清理依据冻结的回执，普通源码修改不会阻止销毁；部署 hooks 仍要求原来审查的输入。
提供方必须明确证明模板由 create-only 操作创建，才能授权清理；不把复用引用当作自有资源。

## 锁定工具链

`application.deployment.toolchainLock` 指向 JSON，字段如下（占位符不能执行）：

```json
{
  "schemaVersion": 1,
  "node": {"sha256": "REPLACE_ME"},
  "serverlessDevs": {
    "directory": "/reviewed/s-bundle",
    "executable": "/reviewed/s-bundle/bin/s.js",
    "version": "REPLACE_ME",
    "sha256": "REPLACE_ME"
  },
  "fc3": {
    "directory": "/reviewed/fc3-bundle",
    "version": "REPLACE_ME",
    "sha256": "REPLACE_ME"
  }
}
```

锁定实际 Node 二进制和包含依赖的完整工具包，不能只计算 npm 启动脚本。
`src/application/config.ts` 的 `toolDigest` 定义树摘要：排序的相对路径与文件 SHA256，
内部符号链接绑定到树内目标。apply 不自动下载工具，s 使用已验证 fc3 的绝对目录，
并移除执行注入环境变量及组件版本覆盖。每次 s 调用使用新的配置目录，不继承默认环境覆盖或全局组件插件。

首版只接受静态、预构建并固定摘要的 custom-container 项目；动态表达式、部署 actions、
浮动镜像标签和未支持的原生字段会明确失败。构建发生在 plan 前，hook 不能改写已接受的输入。
生成的 s 文件只包含审查值与提供方模板引用派生的运行时绑定。

## Hooks 与运行依赖

`application.hooks.beforeApply` / `afterReady` 是可选的开发机/CI 命令，声明 argv、cwd、
超时和环境变量白名单。通过 `ABX_HOOK_CONTEXT_FILE` / `ABX_HOOK_RESULT_FILE` 交换 JSON；
退出码为 0 且返回匹配 operationId 的 passed 才通过。结果和诊断上限为 64 KiB。
未知字段、重复 ID、不安全路径、无效 UTF-8 或 ID 不匹配均失败。
afterReady 得到脱敏的自有原生 ID；成功后也清理同进程组子进程。
脚本仍是可信主机代码，应在受控 CI runner 执行。

容器需配置已有 PostgreSQL、身份、网络绑定和可信 runtime factory。
凭据不放在 inline、根环境值或工具锁中，由 factory 经角色/引用解析。
部署器注入 `ABX_APP_REVISION`、`ABX_APP_SANDBOX_TEMPLATE`、`ABX_APP_SANDBOX_PROVIDER`、
`ABX_APP_SPEC_JSON`，模板不能覆盖这些字段。

参考运行时使用有界数据库产物，不表示对象存储已实现；托管 B 的进度 relay/checkpoint、
多个部署后端仍是后续能力。本地测试不代表云端 IAM、FC 时序、真实模型、产物桶或生产部署验收。
