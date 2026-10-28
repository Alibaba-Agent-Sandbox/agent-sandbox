# Getting Started

This tutorial walks you through the complete sandbox lifecycle, from installation to teardown.

---

## Prerequisites

- Node.js 20 or later only for a from-source install. The binary installer does not need Node.js.
- For the default provider (`alicloud-express`): an API key from the [Agent Sandbox product docs](https://help.aliyun.com/zh/functioncompute/product-overview-of-fc-agent-sandbox). The variable is `ABX_SANDBOX_API_KEY`. The AccessKey pair is `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET`. Native provider/MCP configuration uses the `ABX_SANDBOX_*` names. The standard Express entry also accepts `E2B_API_KEY`, `E2B_API_URL` and `E2B_DOMAIN`; see the [migration guide](migrate-from-e2b.md). `AccessKey` and `AccessSecret` are not read.
- Network access to the Alibaba Cloud Hangzhou region (default `cn-hangzhou`)

## 1. Installation

macOS and Linux:

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
abx --version
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
abx --version
```

For npm (Node.js20+), first check `npm view @agent-sandbox/cli version --registry=https://registry.npmjs.org`, then install with `npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org` once the index resolves the version. From source (`git clone`, `npm ci`, `npm run build`, `npm pack`, `npm install -g ./agent-sandbox-cli-<version>.tgz`), manual downloads, and `abx: command not found`: [Binary Installation](binary-installation.md). The v0.2.0 release assets are named `ebx-*`; the installer uses `abx-*` and uses the published v0.4.0 assets.

## 2. Configure the API Key

There are two ways to configure credentials. When a call actually needs the key, this is the order (highest first). The full table is in [Configuration — Credential resolution](../reference/configuration.md#credential-resolution).

### Option 1: Environment variable (recommended for CI/CD)

```bash
export ABX_SANDBOX_API_KEY="your-api-key-here"
```

### Option 2: `abx config set` (recommended for local development)

Used when neither the environment nor the project `.env` sets the key.

```bash
abx config set sandbox_api_key your-api-key
# Writes to ~/.abx/.env (permissions 600)
```

Verify the configuration:

```bash
abx config get sandbox_api_key
```

## 3. Create Your First Sandbox

### Using the CLI

```bash
abx create base --detach
```

`base` is the default template. Use the template catalog to choose an application-specific environment.

## 4. Execute Code

### CLI

```bash
abx exec <sandbox-id> "echo 'Hello from sandbox'"
```

## 5. Run Shell Commands

### CLI

```bash
abx exec <sandbox-id> sh -c "pip install requests && python -c 'import requests; print(requests.__version__)'"
```

## 6. File Operations

### CLI upload/download

```bash
# Upload
abx upload <sandbox-id> ./data.csv /home/user/data.csv

# Download
abx download <sandbox-id> /home/user/result.csv ./result.csv
```

## 7. List Directory Contents

```bash
abx sandbox files list <sandbox-id> --path /home/user
```

## 8. Destroy a Sandbox

### CLI

```bash
abx kill <sandbox-id>

# Destroy all running sandboxes
abx kill --all
```

## 9. Complete Example

```bash
# Create a sandbox and upload a project
abx create base --detach
abx upload <sandbox-id> ./project /home/user/project

# Run something inside it
abx exec <sandbox-id> "python /home/user/project/main.py"

# Fetch the result and tear the sandbox down
abx download <sandbox-id> /home/user/result.csv ./result.csv
abx kill <sandbox-id>
```

---

## Next Steps

- [Authentication](authentication.md) — Authentication methods and configuration priority
- [CLI Tutorial](cli-tutorial.md) — Full CLI lifecycle operations
- [Using Templates](using-templates.md) — Create sandboxes from templates
- [Error Codes Reference](../reference/error-codes.md) — Error troubleshooting
- [Troubleshooting](troubleshooting.md) — Common issues and solutions

## Related SDK documentation

Using the Python SDK instead of (or next to) the CLI: [Getting Started (SDK)](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/getting-started.md) and the [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) in the `python-sdk` repository.
