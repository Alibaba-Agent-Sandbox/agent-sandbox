# Skill 工作流验收

CLI／MCP 操作选择 `agent-sandbox`，Python 与模板实现选择 `agent-sandbox-sdk`，安装或选择已有提供方选择 `awesome-providers`，编写新后端选择 `agent-sandbox-provider`。加载所选 Skill 及引用目录后，还要验证具体后端。Skill 提供操作说明，不会安装托管服务或增加后端 API。

[17项实测矩阵](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.agents/evidence/verify/2026-10-26-skills-delivery-acceptance.md)逐条记录实际结果和限制。[Issue46](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/46)保持开放。基础执行、持久化、模板、快照、框架和第三方工具已有真实云端证据；原生 WarmPool、完整成本归属、自动预热池同步和长期托管远程 MCP 仍需补齐验收。

安装后的快速检查：使用已授权的 Team、地域和就绪模板，要求 Agent 只创建一个有效期合理的沙箱，执行 `python3 -c "print(6*7)"`，写入并读回唯一文件，查看状态，最后仅删除本次沙箱。保留实际返回的句柄，并独立确认资源不存在。客户端必须配置可用模型，并明确允许该 MCP 配置。Qwen Code0.19.3 已通过实际 MCP 工具完成此流程；前面的模型、配置和测试预算失败均保留在记录中。

后端声明支持 shell 执行、未支持 `code.execute` 时，使用 `run_command`。极速版 `base` 的逐实例规格覆盖可能被后端忽略；当前源码的 MCP 会核对实际规格，不一致就回滚本次沙箱。需要特定规格时，选择匹配资源的模板。安装 Skill 不会给旧发行包补上源码修复。

HTTPS 凭证注入要求平台 CA。官方 base／code-interpreter v0.0.44 及更新镜像带有对应证书；旧 `base` 测试出现 curl60 证书错误，单独创建的官方 v0.0.44 模板则验证了无凭证401、平台注入凭证后200，全程启用 TLS 校验，密钥不进入沙箱代码或环境变量。[官方前提](https://help.aliyun.com/zh/agent-sandbox/outbound-request-header-transformation)。不要输出 `getInfo().network.rules`，其中可能返回明文凭证。

桌面私有应用端口使用 `secure=True`、`allow_public_traffic=False` 以及 traffic-access token 对应请求头。envd token 和 VNC 密码用途不同。控制器测试确认了缺少流量令牌403、错误密码拒绝、实际画面、模拟操作员输入和 Agent 恢复操作；回放是截图时间线。参见 [SDK 维护的验收脚本](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/desktop_acceptance.py)。

成本分析必须读取真实账单，缺少 Team／Template 归属的数据保留为未分配。被测账单无可用标签，逐 Sandbox 金额仅保存在本地私有报告中。不能据此编造利用率、WarmPool 节省金额或 Cache 费用。三次延迟样本也不能证明 SLA。[官方定价](https://help.aliyun.com/zh/agent-sandbox/product-overview/billing-overview)。

源码修复、实云通过、客户端覆盖和已发布版本分别记录。每个脚本只清理自己的资源，删除受理后继续独立验证资源不存在。
