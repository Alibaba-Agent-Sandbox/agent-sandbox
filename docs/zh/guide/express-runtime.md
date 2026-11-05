# 配置极速版沙箱运行环境

极速版运行操作使用所选 Sandbox API Key 和对应地域的 API 地址。它们与使用阿里云凭据的 Team、Key、Volume 元数据管理分开。采用已准备的 AK/SK 管理 Key 时，运行操作会复用该 Key；创建或续期凭据仍需单独确认。

请使用 `abx provider command list alicloud-express` 能列出 `sandbox.mounts.append`、`sandbox.network.update` 和 `sandbox.timeout` 的 CLI 构建。操作出现在目录中，不代表账号白名单已开通，也不会自动准备存储客户端、角色或网络资源。

## 创建时配置网络

明确的 native 入口接受网络 JSON 文件；标准 create 的终端和生命周期行为保持不变：

```sh
abx --native create --template TEMPLATE --network-file ./network.json
```

文件使用与运行时操作相同的 snake_case 字段，另支持两个仅创建时可设的字段：

```json
{
  "allow_public_traffic": false,
  "allow_internet_access": false,
  "allow_out": ["api.example.com"],
  "deny_out": ["0.0.0.0/0"],
  "rules": {
    "api.example.com": [{"transform": {"headers": {"X-Application": "sandbox"}}}]
  }
}
```

`allow_public_traffic` 控制公网应用地址是否允许匿名访问；`allow_internet_access`、`allow_out` 和 `deny_out` 控制出网。native create 使用安全的 envd 访问，私有公网网关需要该配置。创建时也可设置 `mask_request_host`，不支持 `egress_proxy`。包含凭据的规则应保存在受保护的本机文件中，通过 `--network-file` 或 `--input-file` 传入。

VPC 或创建时直接存储挂载可继续通过 native `--metadata KEY=VALUE` 输入官方保留字段。ACR 拉取镜像所用的网络是另一项配置。具体字段见官方[网络说明](https://help.aliyun.com/zh/agent-sandbox/network-access-control)与[存储说明](https://help.aliyun.com/zh/agent-sandbox/persistence-storage/)。

## 调用私有网关后的应用

公网网关 traffic token、envd 会话 token 和应用认证 token 各有用途。CLI 默认不打印或保存网关 token；需要在不同 CLI 进程间复用时，显式指定一个新的私有输出文件：

```sh
abx --native create --template TEMPLATE --network-file ./network.json --traffic-token-output ./traffic-token
abx run alicloud-express:SANDBOX_ID COMMAND --traffic-token-file ./traffic-token --json-args '{"value":1}'
abx sandbox command list alicloud-express:SANDBOX_ID --traffic-token-file ./traffic-token
```

输出文件以 0600 独占创建，不覆盖已有文件；输入必须是私有的常规文件。该 token 通过 `e2b-traffic-access-token` 发送，与应用认证分开。命名命令仍要求模板应用服务正在运行。携带已有 traffic token 进行连接，不会隐式恢复沙箱或延长其期限。

GET info/list 不会取回丢失的网关 token。需要恢复凭据时，应显式选择会更改生命周期的标准 SDK connect/resume 流程，或使用此前保留的 token。原生 CLI resume 的确认结果不导出 token。Sandbox API Key、envd token、ABX_SERVER_TOKEN 均不能替代该凭据。显式导出的文件不再需要时应自行删除。

## 整体替换出网策略

在输入文件的 `network` 中填写完整的目标配置：

```json
{
  "sandbox_id": "SANDBOX_ID",
  "network": {
    "allow_internet_access": false,
    "allow_out": ["api.example.com"],
    "deny_out": ["0.0.0.0/0"]
  }
}
```

```sh
abx provider command run alicloud-express sandbox.network.update --input-file ./network-update.json --yes
```

更新会整体替换出网配置，不与原规则合并。显式 `"network": {}` 会清空原有规则。仅创建时可设的 `allow_public_traffic` 和 `mask_request_host` 不接受更新。请求转换放在 `network.rules` 中；凭据注入应使用精确域名，并满足 HTTPS 平台 CA 要求。结果只确认更新，不回显可能包含凭据的规则。验证应检查真实应用响应，不能只看 TCP 是否建立连接。

## 追加存储挂载

可向运行中的沙箱追加同一 Team 中已有的 Volume 名称、直接存储配置，或同时使用两者：

```json
{
  "sandbox_id": "SANDBOX_ID",
  "named_volume_mounts": [{"name":"workspace","path":"/mnt/workspace"}],
  "request_timeout": 120
}
```

```sh
abx provider command run alicloud-express sandbox.mounts.append --input-file ./mounts.json --yes
abx --json provider command info alicloud-express sandbox.mounts.append
```

直接配置放在 `inline_volume_mounts` 中。每个存储组都有 `mount_points` 数组，挂载点字段如下：

| 存储组 | 挂载点字段 | 组级设置 |
| --- | --- | --- |
| `oss` | `bucket_name`、`endpoint`、`mount_dir`；可选 `bucket_path`、`read_only` | 无 |
| `agentic_fs` | `server_addr`、`mount_dir` | 可选 `user_id`、`group_id` |
| `agentic_bucket` | `agentic_bucket`、`bucket_name`、`endpoint`、`mount_dir`；可选 `bucket_path`、`read_only` | 无 |
| `juice_fs` | `volume_name`、`mount_dir`、`token`；可选 `remote_dir`、`args` | 可选 `envs`；沙箱尚未设置 JuiceFS 服务地址时须包含 `BASE_URL` |

本地目录必须是规范化的绝对 Unix 路径，不能位于系统或隐藏目录，不能重复或相互重叠。单个直接存储组最多接受五个挂载点；服务还会累计已有挂载数量。JuiceFS 的 `args` 不能重复提供平台管理的 `--token` 或 `--subdir`。

追加操作保留已有挂载和沙箱当前角色、VPC。所需的存储客户端、访问策略、角色与网络必须事先可用。它不卸载、不替换，也不创建底层存储。成功确认不能替代数据访问验证：应读取预期文件，或对自己拥有的测试文件执行写入、读回、删除。服务前提和限制见官方[追加挂载指南](https://help.aliyun.com/zh/agent-sandbox/append-mount-volume)。

## 暂停、恢复和修改期限

```sh
abx pause alicloud-express:SANDBOX_ID
abx resume alicloud-express:SANDBOX_ID
abx sandbox timeout alicloud-express:SANDBOX_ID 600
```

带前缀的引用保留 Provider 归属；与显式选择的 Provider 冲突时，在请求前报错。暂停和恢复仍受服务准入限制。timeout 是生存期限（秒），不是请求超时；修改时不连接或恢复实例。对应 Provider 操作 `sandbox.timeout` 接受 `sandbox_id`、`timeout` 和可选的 `request_timeout`。

运行变更不会自动重放。请求超时可能意味着远端结果未知，应检查沙箱并独立验证挂载或网络，再决定是否重新提交。通过 `abx kill ID` 释放自己创建的沙箱；底层存储数据和显式导出的 traffic-token 文件需要分别清理。
