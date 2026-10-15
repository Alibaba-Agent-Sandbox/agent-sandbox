# 常见问题（FAQ）

---

## 连接超时

### 症状

```text
[E5001] Failed to connect to sandbox service
  Suggestion: Check network connectivity and firewall rules.
```

### 排查

1. **检查网络**：确认可以访问 `api.cn-hangzhou.e2b.fc.aliyuncs.com`
   ```bash
   curl -I https://api.cn-hangzhou.e2b.fc.aliyuncs.com
   ```

2. **检查超时配置**：增大 HTTP 超时
   ```bash
   abx config set http_timeout 60
   ```

3. **检查代理**：如果在代理环境中，确保 `https_proxy` 正确配置

4. **检查区域**：确认区域设置正确
   ```bash
   abx config get region
   ```

---

## 认证失败

### E1001 — API Key 无效或缺失

```text
[E1001] API key cannot be empty
  Suggestion: Check your ABX_SANDBOX_API_KEY environment variable or pass sandbox_api_key.
```

**解决**：
```bash
# 检查配置状态
abx config get sandbox_api_key

# 重新设置 API Key
abx config set sandbox_api_key your-api-key

# 或设置环境变量
export ABX_SANDBOX_API_KEY="your-api-key"
```

### E1003 — AK/SK 凭证无效

```text
[E1003] AccessKey ID and Secret cannot be empty
```

**解决**：确保同时设置了 AK ID 和 AK Secret：
```bash
export ALICLOUD_ACCESS_KEY_ID="your-ak-id"
export ALICLOUD_ACCESS_KEY_SECRET="your-ak-secret"
```

### E1002 — Token 过期

```text
[E1002] The SDK should auto-refresh tokens. If this persists, check system clock synchronization.
```

**解决**：检查系统时钟是否准确。SDK 会自动刷新 AK/SK 临时 token（有效期 3600 秒，到期前 300 秒刷新）。

---

## 模板不存在

### E2001 — TemplateNotFoundError

```text
[E2001] Template 'my-template' not found
  Suggestion: Run 'abx template list' to see available templates.
```

**解决**：

1. 检查模板名称拼写
2. 确认模板已安装：
   ```bash
   abx template install owner/repo
   ```
3. 使用默认模板测试：
   ```bash
   abx create --template base
   ```

---

## 能力不支持（E3004）

### 症状

```text
[E3004] Capability 'ports' is not supported by this sandbox template.
  Suggestion: Declare 'ports' in the template's capabilities list (template.yaml) or use a template that supports it.
```

### 解释

Agent Sandbox 使用能力模型控制沙箱功能。每个能力需要在模板中显式声明：

| 能力 | 默认包含 | 需要显式声明 |
|------|----------|-------------|
| `shell` | ✅ | — |
| `files` | ✅ | — |
| `code` | ✅ | — |
| `terminal` | ❌ | 需在 template.yaml 中声明 |
| `ports` | ❌ | 需在 template.yaml 中声明 |

### 解决

如果需要使用 `terminal` 或 `ports` 能力，使用声明了该能力的模板，或创建自定义模板：

```yaml
# template.yaml
name: my-web-template
capabilities:
  - shell
  - files
  - code
  - terminal
  - ports
```

> **Server 端能力组注意**：Server 端有 8 个能力组。其中 TERMINAL 默认启用，仅 DEV_TOOLS 和 BROWSER 默认禁用（`_DEFAULT_DISABLED = {DEV_TOOLS, BROWSER}`）。客户端能力（`capabilities` 字段）和 Server 端能力组是不同层面的控制。

---

## 配额超限

### E2002 — QuotaExceededError

```text
[E2002] Sandbox quota has been exceeded
  Suggestion: Destroy idle sandboxes or request a quota increase.
```

**解决**：

```bash
# 查看运行中的沙箱
abx list --status running

# 销毁不需要的沙箱
abx kill sbx-xxxx

# 批量销毁
abx kill --all --yes
```

---

## 命令执行超时

### E3001 — CommandTimeoutError

```text
[E3001] Command execution timed out
  Suggestion: Increase the timeout parameter or check if the command is hanging.
```

**解决**：

```python
# SDK 中增加超时
result = await sandbox.commands.run("long-command", timeout=300)

# CLI 中增加超时
abx exec sbx-xxxx "long-command" --timeout 300
```

---

## 部署相关

### E7001 — 缺少 LLM Key

> `abx deploy` 不需要 LLM Key；CLI 的 AI 步骤（`abx create "..."`、`abx template init "..."`、`abx template init --adopt`）使用 `abx config` 中的 Qwen Code 凭据。

```text
[E7001] No LLM API key found for the qwen-code agent.
  Suggestion: Set BAILIAN_CODING_PLAN_API_KEY, DASHSCOPE_API_KEY, or OPENAI_API_KEY environment variable.
```

**解决**：设置任一 LLM API Key：

```bash
export DASHSCOPE_API_KEY="your-key"
# CLI（create / template init）：abx config set llm_api_key your-key
```

### 没有 Dockerfile

目录里没有 `Dockerfile` 时，`abx deploy` 会停下，并给出三条编写命令：已有源码用 `abx template init --adopt .`，用一句话新建项目用 `abx template init "描述"`，脚手架用 `abx template init -t python`。文件写好之后再执行 `abx deploy`。

非交互的 `--adopt` 如果没带 `-y`，会停在 “Confirmation required before project files are sent to the model.”。加上 `-y` 即同时批准两次确认；`--dry-run` 只列出文件，不发送。

### 长时间步骤看起来停住了

终端上标题应持续走动（`Building Docker image locally... 12s`，然后 `13s`）。最近六行日志以灰色显示在标题下方。如果只看到一行、没有耗时，当前会话是 `--quiet`、`--json`、`--ci`、`TERM=dumb`，或者不是终端。去掉这些选项就能看到动态块。`--verbose` 改为打印完整的部署日志。`ABX_ACTIVITY_LINES`（1–10，默认 6）决定保留几行灰色文字。灰色行会带上一小段已脱敏的工具详情（命令、url、查询或路径）。文件内容、思考内容和凭证保持隐藏。

### E7003 — 部署超时

**解决**：增加 `max_wall_time` 参数或简化部署任务。

---

## 文件操作

### E4001 — 文件未找到

```python
# 先检查文件是否存在
exists = await sandbox.files.exists("/path/to/file")
if not exists:
    print("文件不存在")

# 列出目录内容
entries = await sandbox.files.list("/home/user")
```

### E4002 — 权限被拒绝

检查文件权限。沙箱默认用户为 `user`，可在命令中指定 `user` 参数。

---

## 快捷方式目标无效

快捷方式的目标是命令路径，不是带 `abx` 的完整调用。下面的写法会被拒绝，且不会保存：

```bash
abx config set shortcuts.aaaaa "abx template init"
```

```text
Invalid shortcut target: 'abx template init'
  Suggestion: Drop the leading "abx". The target is the command path only, for example "template init".
              Try: abx config set shortcuts.aaaaa "template init"
```

按提示里的命令重试即可。如果 `~/.abx/config.toml` 里已经写了 `aaaaa = "abx template init"`，下次启动 `abx` 会警告 `Invalid shortcut ignored` 并跳过这一条，其他快捷方式仍然可用。不认识的路径（例如 `"not-a-command"`）同样会被拒绝，并按命令分组列出合法目标。

---

## 安装问题

### npm install 失败

```bash
# 确保使用正确的包名
npm install -g @agent-sandbox/cli

# 如果遇到依赖冲突
npm install -g @agent-sandbox/cli --force
```

### abx: command not found

二进制安装脚本在目录不在 `PATH` 上时，会打印需要添加的那一行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

然后新开一个终端。在 Windows 上，`install.ps1` 会更新用户 `PATH`；安装前已经打开的终端看不到这次更新。

`npm install -g @agent-sandbox/cli` 即将提供，包尚未发布。npmmirror 等镜像上可能仍有无关的 `@agent-sandbox/cli@0.2.2`，它的 bin 是 `agent-sandbox`，不是 `abx`。卸载：

```bash
npm uninstall -g @agent-sandbox/cli
command -v agent-sandbox
```

完整说明：[二进制安装 — 故障排查：abx: command not found](binary-installation.md#故障排查abx-command-not-found)。

---

## 下一步

- [认证详解](authentication.md) — 认证配置
- [配置参考](../reference/configuration.md) — 所有配置项
- [错误码参考](../reference/error-codes.md) — 完整错误码列表
