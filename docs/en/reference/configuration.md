# Configuration Reference

> Scope: this page describes native provider/MCP configuration and errors. Native configuration uses `ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL` and `ABX_SANDBOX_DOMAIN`. The standard Express command entry additionally accepts `E2B_API_KEY`, `E2B_API_URL` and `E2B_DOMAIN`, mapped at that entry only, and falls back to project configuration. Standard command flags, terminal environment and error behavior follow the [migration guide](../guide/migrate-from-e2b.md).

This document lists all Agent Sandbox configuration options, environment variables, default values, and priority rules.

---

## Configuration Priority

Configuration is loaded in the following priority order (highest to lowest):

```text
1. Explicit options / arguments (CLI options such as --region; SDK keyword arguments)   ← Highest
2. Process environment variables
3. .env files (./.env, then ~/.abx/.env)
4. ~/.abx/config.toml
5. Built-in defaults                                  ← Lowest
```

Each key has exactly one environment variable. The first layer that sets that variable wins. The built-in provider reads `ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL`, `ABX_SANDBOX_DOMAIN`, `ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET`, and `ALIBABA_CLOUD_REGION_ID`. It does not read `E2B_API_KEY`, `E2B_API_URL`, `E2B_DOMAIN`, `AccessKey`, `AccessSecret`, `ALIBABA_CLOUD_ACCESS_KEY_ID`, or `ALIBABA_CLOUD_ACCESS_KEY_SECRET`.

`.env` files are merged **per key**. `./.env` overrides `~/.abx/.env` when both set the same key. A key that the project file does not set still comes from `~/.abx/.env`.

A blank or whitespace-only value does not count. It does not hide the next layer.

## Credential resolution

Every credential uses that order at the moment it is needed. `abx config list` shows the winner and labels it `(env)`, `(user)`, `(default)`, or `(not set)`.

Each key has one name. Product settings use `ABX_<KEY>`. A vendor that already publishes a variable keeps that variable: Alibaba Cloud access keys are `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET`, the region is `ALIBABA_CLOUD_REGION_ID`, ACR settings are `ACR_NAMESPACE` and the matching `ACR_*` variables, and the GitHub token is `GITHUB_TOKEN`. `team_id` is optional and is not required; its environment variable is `ABX_ALICLOUD_EXPRESS_TEAM_ID`.

| What you need | Key | Environment variable |
|---|---|---|
| Sandbox API key | `sandbox_api_key` | `ABX_SANDBOX_API_KEY` |
| Sandbox API base URL | `sandbox_base_url` | `ABX_SANDBOX_BASE_URL` |
| Data-plane domain | `sandbox_domain` | `ABX_SANDBOX_DOMAIN` |
| Region | `region` | `ALIBABA_CLOUD_REGION_ID` |
| Alibaba Cloud AK / SK | `access_key_id` / `access_key_secret` | `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET` |
| ACR namespace / password | `acr_namespace` / `acr_password` | `ACR_NAMESPACE` / `ACR_PASSWORD` |
| GitHub token | `github_token` | `GITHUB_TOKEN` |
| LLM API key | `llm_api_key` | `ABX_LLM_API_KEY` |
| LLM base URL | `llm_base_url` | `ABX_LLM_BASE_URL` |
| LLM model | `llm_model` | `ABX_LLM_MODEL` |
| Default provider | `provider` | `ABX_PROVIDER` |
| Team id (optional) | `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` |

The same chain is what these calls read:

- natural-language `abx create` (the coding agent)
- `abx template install` / `abx template search` (GitHub token)
- `abx mcp install` / `abx mcp start` (Sandbox access is resolved without copying the key into IDE files)

`abx mcp install` does not copy Sandbox credentials into Cursor, Claude, or VS Code files. It records the launch command and applicable non-secret effective target settings. `abx mcp start` resolves user/Provider credentials again when the editor starts the server. Temporary setup values do not persist into that later process; save them explicitly if future launches need them. See [guided configuration](../guide/guided-configuration.md) for inline input, persistence, source conflicts, and automation boundaries.

`abx config list` marks a process variable as `(env)` and either file as `(user)`. The value in the table is the one the command will use.

---

Sandbox calls require `ABX_SANDBOX_API_KEY`; AK/SK settings configure separate official control-plane operations and cannot substitute for it. See [authentication migration](../guide/authentication.md).

## Environment Variables

### Shared with the Python SDK

| Environment Variable | Config key | Description |
|---------------------|-------------|-------------|
| `ABX_PROVIDER` | `provider` | Default provider id |
| `ABX_SANDBOX_API_KEY` | `sandbox_api_key` | Sandbox API key |
| `ABX_SANDBOX_BASE_URL` | `sandbox_base_url` | Platform API URL |
| `ABX_SANDBOX_DOMAIN` | `sandbox_domain` | Data plane domain |
| `ALIBABA_CLOUD_REGION_ID` | `region` | Region |
| `ABX_HTTP_TIMEOUT` | `http_timeout` | HTTP timeout in seconds |
| `ABX_LOG_LEVEL` | `log_level` | SDK log level |
| `ABX_DEFAULT_TEMPLATE` | `default_template` | Default template |
| `ALICLOUD_ACCESS_KEY_ID` | `access_key_id` | Alibaba Cloud AccessKey ID |
| `ALICLOUD_ACCESS_KEY_SECRET` | `access_key_secret` | Alibaba Cloud AccessKey Secret |
| `GITHUB_TOKEN` | `github_token` | GitHub token for template downloads (store with `abx config set github_token`; CI: inject as a secret) |

### CLI only: template build and generation

The Python SDK is a runtime client and does not declare these keys; the CLI declares them in `src/utils/cli_config_keys.ts`.

| Environment Variable | Config key | Description |
|---------------------|-------------|-------------|
| `ACR_NAMESPACE` | `acr_namespace` | ACR namespace (`abx config set acr_namespace`, or `abx config init`) |
| `ACR_REGISTRY` | `acr_registry` | ACR registry host |
| `ACR_REPO` | `acr_repo` | ACR repository |
| `ACR_USERNAME` | `acr_username` | ACR user name |
| `ACR_PASSWORD` | `acr_password` | ACR password |
| `ACREE_INSTANCE_ID` | `acr_instance_id` | ACR Enterprise Edition instance |
| `ACR_VPC_ID` | `acr_vpc_id` | ACR VPC |
| `ACR_VSWITCH_IDS` | `acr_vswitch_ids` | ACR vSwitch ids (comma separated) |
| `ACR_SECURITY_GROUP_ID` | `acr_security_group_id` | ACR security group |
| `ABX_ALICLOUD_EXPRESS_TEAM_ID` | `team_id` | Team id. Optional. Not required. |
| `ABX_LLM_API_KEY` | `llm_api_key` | LLM API key (store with `abx config set llm_api_key`) |
| `ABX_LLM_BASE_URL` | `llm_base_url` | LLM base URL |
| `ABX_LLM_MODEL` | `llm_model` | LLM model name |

Each row is the only environment variable for that key. The full chain is in [Credential resolution](#credential-resolution).

### CLI display

These variables change what a terminal shows. They are not stored by `abx config`.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `ABX_ACTIVITY_LINES` | `4` | How many grey lines sit under a `message... 12s` header (integer 1–10). Used by deploy, create, upload, download, template fetch, image registration, the coding-agent install, and `abx kill --all`. |

`--json`, `--quiet`, `--ci`, `TERM=dumb`, and a non-TTY do not draw that header. See [While a command is running](../guide/cli-tutorial.md#while-a-command-is-running).

## config.toml Configuration

Config file path: `~/.abx/config.toml`

```toml
[core]
provider = "alicloud-express"

[transport]
sandbox_base_url = "https://api.cn-hangzhou.e2b.fc.aliyuncs.com"
sandbox_domain = "cn-hangzhou.e2b.fc.aliyuncs.com"
http_timeout = 30.0
# Legacy retry values do not enable builtin HTTP retries.

[providers.alicloud-express]
region = "cn-hangzhou"
```

The top-level shortcuts are fixed in the CLI and have no configuration section.

---

## CLI Configuration Commands

Manage configuration via `abx config`:

```bash
# View all configuration (with source annotations)
abx config list

# Get a single value
abx config get sandbox_api_key

# Set a value
abx config set sandbox_api_key your-new-key
abx config set region cn-beijing
abx config set http_timeout 60

# GitHub token for template downloads (VALUE omitted → masked asterisk prompt)
abx config set github_token
abx config set github_token ghp_xxxxxxxxxxxx

# Clear a single stored value (returns to default / not set)
abx config set region ""
abx config set github_token ""
```

The `region` key set here is the **persistent default** for regional commands. A single invocation can override it with the command-level `--region`/`-r` option (accepted by `abx list`, `abx kill --all`, the template control-plane commands, and `abx mcp deploy`). Resolution priority: command `--region` > `ALIBABA_CLOUD_REGION_ID` > `abx config set region` > `cn-hangzhou`.

### Keys Configurable via abx config

| Config Key | Environment variable | Description |
|-----------|-------------|-------------|
| `sandbox_api_key` | `ABX_SANDBOX_API_KEY` | Sandbox service API key (stored in `~/.abx/.env`) |
| `sandbox_base_url` | `ABX_SANDBOX_BASE_URL` | Platform API URL |
| `region` | `ALIBABA_CLOUD_REGION_ID` | Region |
| `http_timeout` | `ABX_HTTP_TIMEOUT` | HTTP timeout in seconds |
| `max_retries` | `ABX_MAX_RETRIES` | Legacy compatibility value; builtin HTTP does not retry |
| `sandbox_domain` | `ABX_SANDBOX_DOMAIN` | Data plane domain |
| `llm_api_key` | `ABX_LLM_API_KEY` | LLM API key for NL inference and the coding agent |
| `llm_model` | `ABX_LLM_MODEL` | LLM model name (default: `qwen3-coder-plus`) |
| `llm_base_url` | `ABX_LLM_BASE_URL` | LLM API base URL (default: DashScope compatible-mode) |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | Alibaba Cloud AccessKey ID (official control-plane credential) |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | Alibaba Cloud AccessKey Secret (official control-plane credential) |
| `acr_namespace` | `ACR_NAMESPACE` | ACR namespace for `abx template install` / `abx template deploy` (set it with `abx config init --build`) |
| `github_token` | `GITHUB_TOKEN` | GitHub token for template downloads (`abx template install` / `abx template search`; stored in `~/.abx/.env`, shown masked) |
| `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` | Team id. Optional. Not required. |

### Guided Configuration (abx config init)

```bash
abx config init
```

The interactive wizard prompts for: the sandbox API key, the default region, the LLM API key, the ACR namespace (`ACR_NAMESPACE`), the AccessKey ID, and the AccessKey secret. Press Enter to skip a prompt. Secrets and the namespace are stored in `~/.abx/.env` under the one variable for each key; the region goes to `~/.abx/config.toml`. Non-TTY environments or `--yes` never block; the equivalent `abx config set` commands are printed instead.

### AK/SK control-plane configuration

When `access_key_id` and `access_key_secret` are set via `abx config set`, they are stored in `~/.abx/.env` as `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET`. Used for official template/image/ACR control-plane operations, never automatic sandbox-key exchange.

Sandbox runtime requests still require a separate API key. See [Authentication](../guide/authentication.md#aksk-alibaba-cloud-extended-authentication-) for details.

---

## .env File

The CLI reads both `.env` files and merges them per key:

1. `.env` in the current directory (wins when it sets the key)
2. `~/.abx/.env` (used for any key the project file does not set)

`.env` file format. Use the one variable for each key:

```bash
ABX_SANDBOX_API_KEY=your-api-key
ALIBABA_CLOUD_REGION_ID=cn-beijing
```

The `abx config set sandbox_api_key <KEY>` command saves the API Key to `~/.abx/.env` as `ABX_SANDBOX_API_KEY` (file permissions 600). `github_token` is stored as `GITHUB_TOKEN`.

---

## Configuration File Locations Summary

| File | Path | Description |
|------|------|-------------|
| config.toml | `~/.abx/config.toml` | CLI extended configuration (`[core]`, `[transport]`, `[providers.<id>]`, LLM defaults) |
| .env | `~/.abx/.env` | Authentication credentials (written by `abx config set`) |
| .env (local) | `./.env` | Project-level environment variables |
| Session storage | `~/.abx/sessions/*.json` | Local session data |
| Template cache | `~/.abx/templates/` | Installed templates |

---

## Related SDK documentation

The `TransportConfig` field table (types, defaults, automatic region derivation), SDK parameter overrides, the
in-sandbox server variables (`ABX_SERVER_*`, `ABX_PTY_PORT`, `ABX_MAX_UPLOAD_SIZE`) and the deploy-related LLM
variables are documented in the SDK's [Configuration Reference](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/reference/configuration.md)
in the `python-sdk` repository.

### Legacy retry compatibility

`max_retries` (default3) and `retry_base_delay` (default1.0), including their
existing environment/TOML names, remain accepted for configuration and extension
compatibility. The builtin platform/envd HTTP transport does not use either
value and performs one transport attempt. Setting them does not enable automatic
retry or backoff. EPP connections still forward `max_retries`; a plugin's policy
belongs to that plugin and is not a builtin transport guarantee.

Provider-engine rediscovery/read recovery and explicit custom authentication
refresh are separate mechanisms, not controlled by these settings. Applications
that need retries must use a bounded policy for safe reads; reconcile an unknown
write outcome before issuing the mutation again. No automatic retry feature is
introduced by retaining the legacy configuration names.
