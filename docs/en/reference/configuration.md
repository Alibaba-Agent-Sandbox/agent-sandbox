# Configuration Reference

This document lists all Easy Sandbox configuration options, environment variables, default values, and priority rules.

---

## Configuration Priority

Configuration is loaded in the following priority order (highest to lowest):

```text
1. Explicit options / arguments (CLI options such as --region; SDK keyword arguments)   ← Highest
2. Process environment variables
3. .env files (./.env, then ~/.ebx/.env)
4. ~/.ebx/config.toml
5. Built-in defaults                                  ← Lowest
```

Each key has exactly one environment variable. The first layer that sets that variable wins.

`.env` files are merged **per key**. `./.env` overrides `~/.ebx/.env` when both set the same key. A key that the project file does not set still comes from `~/.ebx/.env`.

A blank or whitespace-only value does not count. It does not hide the next layer.

## Credential resolution

Every credential uses that order at the moment it is needed. `ebx config list` shows the winner and labels it `(env)`, `(user)`, `(default)`, or `(not set)`.

Each key has one name. Product settings use `EBX_<KEY>`. A vendor that already publishes a variable keeps that variable: Alibaba Cloud access keys are `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET`, the region is `ALIBABA_CLOUD_REGION_ID`, ACR settings are `ACR_NAMESPACE` and the matching `ACR_*` variables, and the GitHub token is `GITHUB_TOKEN`. `team_id` is optional and is not required; its environment variable is `EBX_ALICLOUD_EXPRESS_TEAM_ID`.

| What you need | Key | Environment variable |
|---|---|---|
| Sandbox API key | `sandbox_api_key` | `EBX_SANDBOX_API_KEY` |
| Sandbox API base URL | `sandbox_base_url` | `EBX_SANDBOX_BASE_URL` |
| Data-plane domain | `sandbox_domain` | `EBX_SANDBOX_DOMAIN` |
| Region | `region` | `ALIBABA_CLOUD_REGION_ID` |
| Alibaba Cloud AK / SK | `access_key_id` / `access_key_secret` | `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET` |
| ACR namespace / password | `acr_namespace` / `acr_password` | `ACR_NAMESPACE` / `ACR_PASSWORD` |
| GitHub token | `github_token` | `GITHUB_TOKEN` |
| LLM API key | `llm_api_key` | `EBX_LLM_API_KEY` |
| LLM base URL | `llm_base_url` | `EBX_LLM_BASE_URL` |
| LLM model | `llm_model` | `EBX_LLM_MODEL` |
| Default provider | `provider` | `EBX_PROVIDER` |
| Team id (optional) | `team_id` | `EBX_ALICLOUD_EXPRESS_TEAM_ID` |

The same chain is what these calls read:

- natural-language `ebx create` (the coding agent)
- `ebx template install` / `ebx template search` (GitHub token)
- `ebx mcp install` (the sandbox API key copied into the editor config)

`ebx mcp install` writes `EBX_SANDBOX_API_KEY` into the Cursor and Claude config. `EBX_SANDBOX_BASE_URL` and `ALIBABA_CLOUD_REGION_ID` are copied into the same file only when the process environment sets them. `ebx mcp start` loads `~/.ebx` again, so a region saved with `ebx config set region` still applies when the editor starts the server.

`ebx config list` marks a process variable as `(env)` and either file as `(user)`. The value in the table is the one the command will use.

---

## Environment Variables

### Common (SDK and CLI)

| Environment Variable | Config key | Description |
|---------------------|-------------|-------------|
| `EBX_PROVIDER` | `provider` | Default provider id |
| `EBX_SANDBOX_API_KEY` | `sandbox_api_key` | Sandbox API key |
| `EBX_SANDBOX_BASE_URL` | `sandbox_base_url` | Platform API URL |
| `EBX_SANDBOX_DOMAIN` | `sandbox_domain` | Data plane domain |
| `ALIBABA_CLOUD_REGION_ID` | `region` | Region |
| `EBX_HTTP_TIMEOUT` | `http_timeout` | HTTP timeout in seconds |
| `EBX_LOG_LEVEL` | `log_level` | SDK log level |
| `EBX_DEFAULT_TEMPLATE` | `default_template` | Default template |
| `ALICLOUD_ACCESS_KEY_ID` | `access_key_id` | Alibaba Cloud AccessKey ID |
| `ALICLOUD_ACCESS_KEY_SECRET` | `access_key_secret` | Alibaba Cloud AccessKey Secret |
| `ACR_NAMESPACE` | `acr_namespace` | ACR namespace (`ebx config set acr_namespace`, or `ebx config init`) |
| `ACR_REGISTRY` | `acr_registry` | ACR registry host |
| `ACR_REPO` | `acr_repo` | ACR repository |
| `ACR_USERNAME` | `acr_username` | ACR user name |
| `ACR_PASSWORD` | `acr_password` | ACR password |
| `ACREE_INSTANCE_ID` | `acr_instance_id` | ACR Enterprise Edition instance |
| `ACR_VPC_ID` | `acr_vpc_id` | ACR VPC |
| `ACR_VSWITCH_IDS` | `acr_vswitch_ids` | ACR vSwitch ids (comma separated) |
| `ACR_SECURITY_GROUP_ID` | `acr_security_group_id` | ACR security group |
| `EBX_ALICLOUD_EXPRESS_TEAM_ID` | `team_id` | Team id. Optional. Not required. |
| `GITHUB_TOKEN` | `github_token` | GitHub token for template downloads (store with `ebx config set github_token`; CI: inject as a secret) |
| `EBX_LLM_API_KEY` | `llm_api_key` | LLM API key (store with `ebx config set llm_api_key`) |
| `EBX_LLM_BASE_URL` | `llm_base_url` | LLM base URL |
| `EBX_LLM_MODEL` | `llm_model` | LLM model name |

Each row is the only environment variable for that key. The full chain is in [Credential resolution](#credential-resolution).

### CLI display

These variables change what a terminal shows. They are not stored by `ebx config`.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `EBX_ACTIVITY_LINES` | `4` | How many grey lines sit under a `message... 12s` header (integer 1–10). Used by deploy, create, upload, download, template fetch, image registration, the coding-agent install, and `ebx kill --all`. |

`--json`, `--quiet`, `--ci`, `TERM=dumb`, and a non-TTY do not draw that header. See [While a command is running](../guide/cli-tutorial.md#while-a-command-is-running).

## config.toml Configuration

Config file path: `~/.ebx/config.toml`

```toml
[core]
provider = "alicloud-express"

[transport]
sandbox_base_url = "https://api.cn-hangzhou.e2b.fc.aliyuncs.com"
sandbox_domain = "cn-hangzhou.e2b.fc.aliyuncs.com"
http_timeout = 30.0
max_retries = 3

[providers.alicloud-express]
region = "cn-hangzhou"

[shortcuts]
init = "template init"          # command path, not "ebx template init"
ps   = "sandbox process list"
```

`[shortcuts]` maps a top-level alias to a command path. The value does not include the `ebx` prefix. `ebx config set shortcuts.ps "ebx sandbox process list"` is rejected; use `"sandbox process list"`. A bad line already in the file is skipped at the next startup and the other aliases keep working. See [Shortcut aliases](cli-reference.md#shortcut-aliases-shortcutsalias).

---

## CLI Configuration Commands

Manage configuration via `ebx config`:

```bash
# View all configuration (with source annotations)
ebx config list

# Get a single value
ebx config get sandbox_api_key

# Set a value
ebx config set sandbox_api_key your-new-key
ebx config set region cn-beijing
ebx config set http_timeout 60

# GitHub token for template downloads (VALUE omitted → masked asterisk prompt)
ebx config set github_token
ebx config set github_token ghp_xxxxxxxxxxxx

# Clear a single stored value (returns to default / not set)
ebx config set region ""
ebx config set github_token ""
```

The `region` key set here is the **persistent default** for regional commands. A single invocation can override it with the command-level `--region`/`-r` option (accepted by `ebx list`, `ebx kill --all`, the template control-plane commands, and `ebx mcp deploy`). Resolution priority: command `--region` > `ALIBABA_CLOUD_REGION_ID` > `ebx config set region` > `cn-hangzhou`.

### Keys Configurable via ebx config

| Config Key | Environment variable | Description |
|-----------|-------------|-------------|
| `sandbox_api_key` | `EBX_SANDBOX_API_KEY` | Sandbox service API key (stored in `~/.ebx/.env`) |
| `sandbox_base_url` | `EBX_SANDBOX_BASE_URL` | Platform API URL |
| `region` | `ALIBABA_CLOUD_REGION_ID` | Region |
| `http_timeout` | `EBX_HTTP_TIMEOUT` | HTTP timeout in seconds |
| `max_retries` | `EBX_MAX_RETRIES` | Maximum retry count |
| `sandbox_domain` | `EBX_SANDBOX_DOMAIN` | Data plane domain |
| `llm_api_key` | `EBX_LLM_API_KEY` | LLM API key for NL inference and the coding agent |
| `llm_model` | `EBX_LLM_MODEL` | LLM model name (default: `qwen3-coder-plus`) |
| `llm_base_url` | `EBX_LLM_BASE_URL` | LLM API base URL (default: DashScope compatible-mode) |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | Alibaba Cloud AccessKey ID (🧪 experimental AK/SK auth) |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | Alibaba Cloud AccessKey Secret (🧪 experimental AK/SK auth) |
| `acr_namespace` | `ACR_NAMESPACE` | ACR namespace for `ebx install` / `ebx template deploy` |
| `github_token` | `GITHUB_TOKEN` | GitHub token for template downloads (`ebx template install` / `ebx template search`; stored in `~/.ebx/.env`, shown masked) |
| `team_id` | `EBX_ALICLOUD_EXPRESS_TEAM_ID` | Team id. Optional. Not required. |

### Guided Configuration (ebx config init)

```bash
ebx config init
```

The interactive wizard prompts for: the sandbox API key, the default region, the LLM API key, the ACR namespace (`ACR_NAMESPACE`), the AccessKey ID, and the AccessKey secret. Press Enter to skip a prompt. Secrets and the namespace are stored in `~/.ebx/.env` under the one variable for each key; the region goes to `~/.ebx/config.toml`. Non-TTY environments or `--yes` never block; the equivalent `ebx config set` commands are printed instead.

### AK/SK Authentication Configuration (Experimental)

When `access_key_id` and `access_key_secret` are set via `ebx config set`, they are stored in `~/.ebx/.env` as `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET`. Used for AK/SK → API Key token exchange authentication.

> **Note**: This feature is experimental. The token exchange endpoint is pending FC platform confirmation. See [Authentication](../guide/authentication.md#aksk-alibaba-cloud-extended-authentication-) for details.

---

## .env File

The CLI reads both `.env` files and merges them per key:

1. `.env` in the current directory (wins when it sets the key)
2. `~/.ebx/.env` (used for any key the project file does not set)

`.env` file format. Use the one variable for each key:

```bash
EBX_SANDBOX_API_KEY=your-api-key
ALIBABA_CLOUD_REGION_ID=cn-beijing
```

The `ebx config set sandbox_api_key <KEY>` command saves the API Key to `~/.ebx/.env` as `EBX_SANDBOX_API_KEY` (file permissions 600). `github_token` is stored as `GITHUB_TOKEN`.

---

## Configuration File Locations Summary

| File | Path | Description |
|------|------|-------------|
| config.toml | `~/.ebx/config.toml` | CLI extended configuration (`[core]`, `[transport]`, `[providers.<id>]`, `[shortcuts]`, LLM defaults) |
| .env | `~/.ebx/.env` | Authentication credentials (written by `ebx config set`) |
| .env (local) | `./.env` | Project-level environment variables |
| Session storage | `~/.ebx/sessions/*.json` | Local session data |
| Template cache | `~/.ebx/templates/` | Installed templates |

---

## Related SDK documentation

The `TransportConfig` field table (types, defaults, automatic region derivation), SDK parameter overrides, the
in-sandbox server variables (`EBX_SERVER_*`, `EBX_PTY_PORT`, `EBX_MAX_UPLOAD_SIZE`) and the deploy-related LLM
variables are documented in the SDK's [Configuration Reference](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/reference/configuration.md)
in the `python-sdk` repository.
