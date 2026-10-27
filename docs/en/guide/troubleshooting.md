# Troubleshooting (FAQ)

---

## Connection Timeout

### Symptoms

```text
[E5001] Failed to connect to sandbox service
  Suggestion: Check network connectivity and firewall rules.
```

### Troubleshooting

1. **Check network**: Confirm you can access `api.cn-hangzhou.e2b.fc.aliyuncs.com`
   ```bash
   curl -I https://api.cn-hangzhou.e2b.fc.aliyuncs.com
   ```

2. **Check timeout configuration**: Increase the HTTP timeout
   ```bash
   abx config set http_timeout 60
   ```

3. **Check proxy**: If behind a proxy, ensure `https_proxy` is configured correctly

4. **Check region**: Confirm the region setting is correct
   ```bash
   abx config get region
   ```

---

## Authentication Failure

### E1001 — Invalid or Missing API Key

```text
[E1001] API key cannot be empty
  Suggestion: Check your ABX_SANDBOX_API_KEY environment variable or pass sandbox_api_key.
```

**Solution**:
```bash
# Check configuration status
abx config get sandbox_api_key

# Re-set API Key
abx config set sandbox_api_key your-api-key

# Or set the environment variable
export ABX_SANDBOX_API_KEY="your-api-key"
```

### E1003 — Invalid AK/SK Credentials

```text
[E1003] AccessKey ID and Secret cannot be empty
```

**Solution**: Ensure both AK ID and AK Secret are set:
```bash
export ALICLOUD_ACCESS_KEY_ID="your-ak-id"
export ALICLOUD_ACCESS_KEY_SECRET="your-ak-secret"
```

### E1002 — Token Expired

```text
[E1002] envdAccessToken not available. Sandbox may not be created or connected.
```

**Solution**: Check that the system clock is accurate. Reconnect for a current envd token. Managed API-key creation and renewal require explicit confirmation; see [permissions](permissions.md).

---

## Template Not Found

### E2001 — TemplateNotFoundError

```text
[E2001] Template 'my-template' not found
  Suggestion: Run 'abx template list' to see available templates.
```

**Solution**:

1. Check the template name for typos
2. Confirm the template is installed:
   ```bash
   abx template install owner/repo
   ```
3. Test with the default template:
   ```bash
   abx create base
   ```

---

## Capability Not Supported (E3004)

### Symptoms

```text
[E3004] Capability 'ports' is not supported by this sandbox template.
  Suggestion: Declare 'ports' in the template's capabilities list (template.yaml) or use a template that supports it.
```

### Explanation

Agent Sandbox uses a capability model to control sandbox features. Each capability must be explicitly declared in the template:

| Capability | Included by Default | Requires Explicit Declaration |
|------------|--------------------|-----------------------------|
| `shell` | ✅ | — |
| `files` | ✅ | — |
| `code` | ✅ | — |
| `terminal` | ❌ | Must be declared in template.yaml |
| `ports` | ❌ | Must be declared in template.yaml |

### Solution

If you need the `terminal` or `ports` capability, use a template that declares it, or create a custom template:

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

> **Server-side capability groups note**: The server has 8 capability groups. TERMINAL is enabled by default; only DEV_TOOLS and BROWSER are disabled by default (`_DEFAULT_DISABLED = {DEV_TOOLS, BROWSER}`). Client-side capabilities (the `capabilities` field) and server-side capability groups are controls at different levels.

---

## Quota Exceeded

### E2002 — QuotaExceededError

```text
[E2002] Sandbox quota has been exceeded
  Suggestion: Destroy idle sandboxes or request a quota increase.
```

**Solution**:

```bash
# View running sandboxes
abx list --status running

# Destroy unneeded sandboxes
abx kill sbx-xxxx

# Batch destroy
abx kill --all
```

---

## Command Execution Timeout

### E3001 — CommandTimeoutError

```text
[E3001] Command execution timed out
  Suggestion: Increase the timeout parameter or check if the command is hanging.
```

**Solution**:

```python
# Increase timeout in SDK
result = await sandbox.commands.run("long-command", timeout=300)

# Increase timeout in CLI
abx exec sbx-xxxx "long-command"  # no local command timeout / 无本地命令超时参数
```

---

## Deployment Issues

### E7001 — Missing LLM Key

> `abx deploy` never needs an LLM key; the CLI's AI steps (`abx create --prompt "..."`, `abx template scaffold --prompt "..."`, `abx template scaffold --adopt`) use the Qwen Code credentials from `abx config`.

```text
[E7001] No LLM API key found for the qwen-code agent.
  Suggestion: Set BAILIAN_CODING_PLAN_API_KEY, DASHSCOPE_API_KEY, or OPENAI_API_KEY environment variable.
```

**Solution**: Set any LLM API Key:

```bash
export DASHSCOPE_API_KEY="your-key"
# For the CLI (create / template init): abx config set llm_api_key your-key
```

### Docker is missing or its daemon is unavailable

Source templates with a Dockerfile need Docker installed and running on the CLI host. Run `docker info`, start Docker Desktop/the daemon, and check the selected context and permissions before retrying. The CLI reports E7020 with the setup reason before starting a build; this prerequisite failure creates no image, push, platform-template or sandbox intent. Native platform steps and managed templates keep their existing prerequisites.

### No Dockerfile

`abx deploy` stops when the directory has no `Dockerfile` and names the three authoring commands: `abx template scaffold --adopt .` for a project that already has source code, `abx template scaffold --prompt "DESCRIPTION"` for a new project from a sentence, and `abx template scaffold -t python` for a scaffold. After the files exist, run `abx deploy` again.

A non-interactive `--adopt` without `-y` stops with "Confirmation required before project files are sent to the model." Pass `-y` to approve both prompts, or `--dry-run` to list the files without sending them.

### A long step looks frozen

On a terminal the header should keep moving (`Building Docker image locally... 12s`, then `13s`). The last six log lines sit under it in grey. If you see a single line and no elapsed time, the session is `--quiet`, `--json`, `--ci`, `TERM=dumb`, or not a terminal. Pass nothing extra for the live block. `--verbose` prints the full deploy log instead. `ABX_ACTIVITY_LINES` (1–10, default 6) changes how many grey lines are kept. Grey rows include a short redacted tool detail (command, url, query, or path). File bytes, thinking, and credentials stay hidden.

### E7003 — Deploy Timeout

**Solution**: Increase the `max_wall_time` parameter or simplify the deployment task.

---

## File Operations

### E4001 — File Not Found

```python
# Check if the file exists first
exists = await sandbox.files.exists("/path/to/file")
if not exists:
    print("File does not exist")

# List directory contents
entries = await sandbox.files.list("/home/user")
```

### E4002 — Permission Denied

Check file permissions. The default user in the sandbox is `user`; you can specify the `user` parameter in commands.

---

## Invalid Shortcut Target

A shortcut target is the command path, not the full invocation. This is rejected and nothing is saved:

```bash
abx config set shortcuts.aaaaa "abx template scaffold"
```

```text
Invalid shortcut target: 'abx template scaffold'
  Suggestion: Drop the leading "abx". The target is the command path only, for example "template init".
              Try: abx config set shortcuts.aaaaa "template init"
```

Use the printed command. If `~/.abx/config.toml` already contains `aaaaa = "abx template scaffold"`, the next `abx` warns `Invalid shortcut ignored` and skips that alias; the other shortcuts still work. An unknown path (for example `"not-a-command"`) is rejected with the legal targets grouped by command.

---

## Installation Issues

### npm install Fails

```bash
# Use the published standalone binary; public npm installation is unavailable
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh

# Verify the installed executable
abx --version
```

### abx: command not found

The binary installer prints the exact line to add when its directory is not on `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Open a new terminal afterwards. On Windows, `install.ps1` updates the user `PATH`; a terminal that was already open does not see it.

Check `npm view @agent-sandbox/cli version --registry=https://registry.npmjs.org` against the official index before installing; if unavailable, use the verified GitHub binary. Mirrors such as npmmirror may still serve an unrelated `@agent-sandbox/cli@0.2.2` whose bin is `agent-sandbox`, not `abx`. Uninstall it:

```bash
npm uninstall -g @agent-sandbox/cli
command -v agent-sandbox
```

Full notes: [Binary Installation — Troubleshooting: abx: command not found](binary-installation.md#troubleshooting-abx-command-not-found).

---

## Next Steps

- [Authentication](authentication.md) — Authentication configuration
- [Configuration Reference](../reference/configuration.md) — All configuration options
- [Error Codes Reference](../reference/error-codes.md) — Complete error code list


## Process inspection and metrics in minimal images

Process inspection first uses `ps`, then Python 3 and `/proc` when procps is absent.
The fallback reports actual kernel data and still fails for an inaccessible process.
System metrics uses a quoted multiline Python script; unavailable load averages are
`null`, not fabricated zeroes. Images without Python retain the existing shell fallback.
For AI clients prefer `--json sandbox system metrics ID` and inspect the returned fields.
