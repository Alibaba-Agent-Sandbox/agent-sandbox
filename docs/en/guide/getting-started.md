# Getting Started

This tutorial walks you through the complete sandbox lifecycle, from installation to teardown.

---

## Prerequisites

- Node.js 20 or later (for the `abx` CLI)
- For the default provider (`alicloud-express`): an API key from the [Agent Sandbox product docs](https://help.aliyun.com/zh/functioncompute/product-overview-of-fc-agent-sandbox). The variable is `ABX_SANDBOX_API_KEY`. The AccessKey pair is `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET`. The CLI does not read `E2B_API_KEY`, `E2B_API_URL`, `E2B_DOMAIN`, `AccessKey`, or `AccessSecret`.
- Network access to the Alibaba Cloud Hangzhou region (default `cn-hangzhou`)

## 1. Installation

```bash
# Install the CLI globally from npm
npm install -g @agent-sandbox/cli

# Or run it without installing
npx @agent-sandbox/cli --version

# Verify the installation
abx --version
```

### Standalone binary (no Node.js required)

If you'd rather not set up a Node.js environment, `abx` is also available as a
precompiled standalone binary for Linux, macOS, and Windows:

```bash
# Example: install v0.3.0 on macOS (Apple Silicon)
curl -fsSL -o "$HOME/abx" \
  "https://github.com/alibaba-agent-sandbox/agent-sandbox/releases/download/v0.3.0/abx-0.3.0-darwin-arm64"
chmod +x "$HOME/abx"
sudo mv "$HOME/abx" /usr/local/bin/abx
```

For other platforms, checksum verification, and a comparison with the npm
install, see the [Binary Installation](binary-installation.md) guide.

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
abx create --template base
```

`base` is the default template. The repository README uses `python-base`, the Python image in the catalog.

## 4. Execute Code

### CLI

```bash
abx exec <sandbox-id> "echo 'Hello from sandbox'"
```

## 5. Run Shell Commands

### CLI

```bash
abx exec <sandbox-id> -- sh -c "pip install requests && python -c 'import requests; print(requests.__version__)'"
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
abx kill --all --yes
```

## 9. Complete Example

```bash
# Create a sandbox and upload a project
abx create --template base --upload ./project

# Run something inside it
abx exec <sandbox-id> "python /home/user/project/main.py"

# Fetch the result and tear the sandbox down
abx download <sandbox-id> /home/user/result.csv ./result.csv
abx kill <sandbox-id> --yes
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
