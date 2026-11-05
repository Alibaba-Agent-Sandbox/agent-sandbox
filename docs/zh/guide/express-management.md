# 管理极速版资源

极速版资源命令用于管理 Team、API Key、Volume、配额、模板和模板缓存，使用阿里云 AccessKey 或 STS 三元临时凭据。沙箱执行、文件和终端使用独立的 Sandbox API Key。

通过 `abx config init --build` 配置 AccessKey ID 和 Secret，或使用已有的 `ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET` 环境变量。凭据来自已获目标资源管理权限的 RAM 身份。使用 STS 签发的临时凭据时，还需设置同一组凭据中的 `ALIBABA_CLOUD_SECURITY_TOKEN`。该令牌属于秘密，会随临时凭据过期；CLI 不负责获取或刷新 STS 凭据。

在本机发现操作及其 JSON 输入规范：

```sh
abx provider command list alicloud-express
abx provider command info alicloud-express volume.update
abx provider command run alicloud-express volume.list --input '{"max_results":20}'
```

使用 `--region` 选择资源地域。列表操作返回一页和续页令牌；继续查询时原样传入 `next_token`。Team 和 API Key 列表使用 `page_number`、`page_size`。写入和删除操作需要 `--yes`；含密码或令牌的配置应通过 `--input-file` 传入。

## 模板

原生 `template.create/get/list/update/delete` 操作接受结构化配置。标准 `abx template create` 保留模板构建语义。原生创建只提交新名称，遇到名称冲突会拒绝；修改已有模板使用显式更新操作。

准备包含目标 Team、镜像和运行时配置的 JSON 文件：

```json
{
  "team_id": "REPLACE_ME",
  "name": "project-runtime-v1",
  "runtime_config": {
    "cpu": 2,
    "memory_size": 2048,
    "disk_size": 15360,
    "sandbox_config": {
      "image": "REPLACE_ME",
      "generation": 2,
      "os_type": "linux-amd64"
    }
  },
  "build_config": {
    "install_storage_clients": true
  }
}
```

镜像须能被所选账号和地域访问。自动安装存储客户端需要二代模板和受支持的镜像；安装只准备镜像，不会创建存储、执行挂载或配置访问权限。

```sh
abx provider command run alicloud-express template.create --input-file template.json --yes
abx provider command run alicloud-express template.get --input-file template-reference.json
```

引用文件包含 `team_id` 和创建返回的 `template_id`。创建返回表示已提交，不表示就绪；确认模板状态为 ready 后再创建沙箱。需要支持时保留构建失败详情和请求 ID。

`runtime_config` 还支持指向已有 SLS Project/Logstore 的 `log_config`，以及沙箱运行网络和角色的 `vpc_config`。`sandbox_config.registry_config.network_config` 用于拉取镜像仓库，与沙箱运行时 VPC 分开。仓库认证和证书配置放在 `registry_config` 中；通过 `provider command info` 查看具体嵌套字段。

更新时只填写需要修改的字段。省略 `sandbox_config.steps` 会保留原步骤，显式传 `steps: []` 会清空步骤。例如：

```json
{
  "team_id": "REPLACE_ME",
  "template_id": "REPLACE_ME",
  "runtime_config": {
    "sandbox_config": {
      "steps": [{"type": "RUN", "args": ["python3 -m pip install cowsay"]}]
    }
  }
}
```

使用 `template.update --input-file update.json --yes` 提交该文件。已有使用者需要保留环境时，应创建新的版本化模板名称。删除模板、沙箱和快照是独立操作。

## Volume 和配额

`volume.create` 在 Team、Volume 名称之外，要求从 `oss_volume_config`、`agentic_fs_volume_config`、`agentic_bucket_volume_config`、`juice_fs_volume_config` 中选择一个配置。它保存已有存储的挂载配置，不创建或复制底层数据。JuiceFS 令牌通过输入文件提供，在返回元数据中脱敏。

`volume.update` 接受一个存储配置和/或 `mount_config`，并要求 `team_id`、`volume_id`。例如更新已有 Volume 的 RAM 角色：

```json
{
  "team_id": "REPLACE_ME",
  "volume_id": "REPLACE_ME",
  "mount_config": {"role": "REPLACE_ME"}
}
```

已弃用的单独 status 输入通过旧版 API 保留兼容，不能与存储或挂载配置混用。新配置更新使用当前 Sandbox API，失败时不会回退到旧 API。`volume.list` 支持 `storage_class` 筛选。删除 Volume 只删除挂载元数据，保留底层数据。

配额更新要求 `team_id`、`cpu_cores`、`memory_gb`。可选的 `instance_count` 控制存活实例数：省略表示保留该项，`-1` 清除，`0` 禁止使用，正整数设置上限。修改 CPU 或内存限制前先查询已有配额。

## API Key 和清理

创建和重置 API Key 时，需要提供 CLI engine 所在机器上尚不存在的绝对 `secret_file` 路径。文件以私有权限独占创建，普通输出不披露密钥。来源 IP 策略接受 IPv4 地址/CIDR；非空白名单和黑名单互斥，空列表可清除已有规则。规则备注最长 128 个字符。

过期时间接受 RFC3339 时间戳或显式空字符串 `expire_time`，后者会原样传给原生 API。更新时省略该字段会保留已有到期时间；请求改为永不过期后，应查询返回元数据确认结果。

管理 Key 的创建或续期需要独立确认。复用已有管理 Key 不授权未经确认的替换；STS 临时凭据也不免除这些要求。

仅清理本任务创建的资源。删除模板缓存保留模板，删除 Volume 保留底层存储；终止沙箱与清理存储中的文件是独立操作。

资源权限和服务条件请参见[provider 命令](provider-commands.md)、[认证](authentication.md)和[官方原生 API 参考](https://api.aliyun.com/document/Sandbox/2026-08-20/overview)。
