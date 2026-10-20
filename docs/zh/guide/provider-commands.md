# Provider 能力注册与共享命令

## Provider 实现一次，两端共同发现

公共宿主负责配置隔离、安装/授权、受限 JSON Schema 校验、引擎认证、错误和通用调度。
Provider 负责厂商 API 映射、认证、资源标识、服务准入、分页。CLI 展示和 Python 异步/类型
封装可以不同，不能在各端分别维护一套云端实现。

极速版是 CLI `src/providers/alicloud_express/` 中随包发布的内置 Provider；其他可安装
Provider 的源码属于 `awesome-providers`。现有 `provider-commands/1` 声明由通用 CLI 与
Python 引擎客户端共同发现。新增已声明操作不要求给各端再加调度表或顶层命令。
稳定的类型化方法仍是显式 API，不会因为注册了名字就动态生成 Python 方法，也不保证
每个后端都支持全部能力。标准 E2B 兼容客户端继续保留自己的协议契约。

极速版新增的注册命令如下：

| ID | 影响 | 输入 |
| --- | --- | --- |
| `sandbox.pause` | 写入 | `sandbox_id`，可选 `request_timeout` |
| `sandbox.resume` | 写入 | `sandbox_id`，可选生命周期 `timeout` |
| `snapshot.create` | 写入 | `sandbox_id`，可选 `name`、`request_timeout` |
| `snapshot.list` | 只读 | 可选 `sandbox_id`、`name`、`limit`、`next_token` |
| `snapshot.restore` | 写入 | `snapshot_id`，可选生命周期 `timeout`、字符串 `metadata` |
| `snapshot.delete` | 删除 | `snapshot_id` |

六个操作只使用所选极速版的 **sandbox API Key**、地址与地域，不要求控制面 AK/SK。
已有 Team/Volume/API-key/Quota 操作仍使用 AK/SK。完整输入限制见命令 Schema。
已实现与账号可用分开判断：暂停恢复和快照各需白名单，快照还要求二代运行时。
HTTP403/409 不能归为 Provider 未声明能力。原生 ProviderSandbox 特性标志保持独立范围；
注册命令不会暗中改变旧原生暂停/恢复协议。

```sh
abx --json provider command list alicloud-express
abx --json provider command info alicloud-express snapshot.create
abx --json provider command run alicloud-express sandbox.pause \
  --input '{"sandbox_id":"<sandbox-id>"}' --yes
abx --json provider command run alicloud-express sandbox.resume \
  --input '{"sandbox_id":"<sandbox-id>","timeout":600}' --yes
abx --json provider command run alicloud-express snapshot.create \
  --input '{"sandbox_id":"<sandbox-id>","name":"checkpoint","request_timeout":300}' --yes
abx --json provider command run alicloud-express snapshot.list \
  --input '{"sandbox_id":"<sandbox-id>","limit":100}'
abx --json provider command run alicloud-express snapshot.restore \
  --input '{"snapshot_id":"<returned-snapshot-uuid>","timeout":300}' --yes
abx --json provider command run alicloud-express snapshot.delete \
  --input '{"snapshot_id":"<returned-snapshot-uuid>"}' --yes
```

Python 通过真实本地引擎调用同一份注册实现：

```python
import asyncio
from agent_sandbox.providers import commands

async def main():
    catalog = await commands.list_commands("alicloud-express")
    print([entry["id"] for entry in catalog])
    # 本地配置 ABX_SANDBOX_API_KEY、ABX_SANDBOX_BASE_URL、ABX_SANDBOX_DOMAIN。
    result = await commands.run_command(
        "alicloud-express", "snapshot.create",
        {"sandbox_id": "<sandbox-id>", "request_timeout": 300}, confirm=True,
    )
    print(result["snapshot_id"])

asyncio.run(main())
```

须使用含有上述声明的 `abx` 构建，可以用 `ABX_BIN` 指定；原始 v0.4.0 发布物尚未包含这次
注册。单独升级 Python 不能让旧引擎凭空增加命令。发现操作不访问云端或检查云凭据，
列出的是已注册实现，不是实时账号能力探测。

创建快照默认请求超时300秒，与沙箱生命周期不同；Provider 外层截止时间360秒。
不自动重试写入。结果不确定时，先按本轮独占源沙箱查询，再决定是否重复创建。
`next_token` 原样传递服务分页游标。恢复会创建新沙箱，不恢复或替换源沙箱；需要在
异常后盘点时，为新沙箱传入唯一 `metadata`。先清理克隆沙箱，再独立删除快照，源沙箱
终止不会自动删除快照。

极速版删除快照使用与模板共用的服务接口。本注册扩展只接受**返回的快照 UUID**，在
发请求前拒绝普通模板名称和别名。结果不包含会话访问 token 或未声明的后端字段。
不提供仅保留文件系统的 `keep_memory=False` 暂停模式。

Python 仓库的手动验收控制器通过两端访问同一个真实 Provider，验证内存/文件连续性、
克隆隔离及自有资源清理；不新增云端/模型 Actions 验收。官方限制：
[暂停恢复](https://help.aliyun.com/zh/agent-sandbox/pause-and-resume)、
[快照](https://help.aliyun.com/zh/agent-sandbox/snapshot-invited-test)。

跨端本地验收使用 [Python 仓库的控制器](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/README.zh-CN.md)，传入本仓库构建的独立二进制；产物不要放在其他构建会清理的目录。

真实验收中，恢复后立即创建快照曾返回 HTTP503；先确认运行状态并等待服务准入稳定，再首次创建。最终验收使用30秒静置间隔，该值是验收观察，不是服务就绪 SLA。失败写入不自动重试。
