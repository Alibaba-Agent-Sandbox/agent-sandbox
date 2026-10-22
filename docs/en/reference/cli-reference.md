# CLI Reference

The Express standard path follows Alibaba's supported E2B CLI 2.20.0 behavior with its protocol client pinned to 2.50.0. See [migration and cloud limits](../guide/migrate-from-e2b.md). Standard command help is authoritative for options; project extension options are documented separately below.

## Command Overview

| Entry | Purpose |
|---|---|
| `abx sandbox` | Standard lifecycle, terminal, process execution and queries; project files/process/system extensions |
| `abx template` | Standard SDK init/create/list and explicit project scaffold/from-image/build/deploy/install extensions |
| `abx config`, `abx provider`, `abx mcp` | Project configuration, provider installation and MCP tooling |

Use `abx config init` for credentials. `abx template init` generates standard SDK build files; Python output imports agent_sandbox. `abx template scaffold` generates project template.yaml/server files. Natural language always uses `--prompt`. Node SDK migration is outside scope.

## Global Options

Project extension commands support global `--json`, `--quiet`/`-q`, `--verbose` and `--ci` where described by their help. Standard commands use their own pinned options, such as `list/info --format json`; CI=true does not rewrite their stdout into a project JSON envelope. Keep E2B_API_KEY, E2B_API_URL and E2B_DOMAIN configured, or use the project config store. AK/SK is used by project image administration; the standard E2B route requires an API key.

## Sandbox Lifecycle Commands

### abx create

```bash
abx create [template] --detach --timeout 300
abx create code-interpreter-v1              # interactive PTY
abx create --prompt "Python data science environment"  # project generation
```

The positional argument is a template and defaults to base. `--detach` prints its ID. Without it create opens a real terminal; default lifecycle requests a one-second timeout after exit, which Alibaba may round to about 60 seconds. Explicit timeout/lifecycle flags retain the pinned behavior. Use `--lifecycle.ontimeout` as documented in `create --help`; there is no standard `--template`, `--upload` or `--yes` option. Creation/env/metadata options are exactly those in the fixed CLI version's help.

### abx list

```bash
abx list --state running --metadata project=demo --limit 100 --format json
```

State and metadata filters, lazy page collection and output formatting follow the fixed version. Use `--state`, not `--status`.

### abx info

```bash
abx info <sandbox-id> --format json
```

Pretty output uses labels including Sandbox ID, Template ID, State and Envd version. JSON uses the standard client model, not the project's ID/Status envelope.

### abx kill

```bash
abx kill <sandbox-id>
abx sandbox kill <id-one> <id-two>
```

Deletion is immediate. There is no confirmation or `--yes` option. `--all` supports state/metadata filters and acts immediately; use it only when the selected set is intended. Missing IDs retain the reference CLI's message and successful status.

### abx exec

```bash
abx exec --cwd /tmp --env MODE=test <sandbox-id> sh -c 'printf "$MODE"; exit 7'
abx exec --background <sandbox-id> python -m http.server 8000
```

All CLI options precede the sandbox ID. Everything after it belongs to the command, including flags named --provider or --prompt. Execution streams stdout/stderr and returns the remote exit code. Background PID is written to stderr. There is no local --stream or --timeout option in this fixed version. Shell syntax in multiple arguments uses an explicit `sh -c`. Piped stdin depends on the backend envd version, with the same warning/version guard as the reference.

### abx connect

```bash
abx connect <sandbox-id>
```

Connect opens a real PTY: cwd, environment and terminal state persist between commands. Terminal exit leaves the existing sandbox alive. It requires a terminal; the E2E suite uses an actual local PTY rather than a line-input simulation.

### Conditional lifecycle capabilities

`sandbox pause` and `sandbox resume` keep standard options, subject to Alibaba runtime/allowlist restrictions. Snapshot and network capabilities are described in the migration guide. Exposing a command does not enable an unavailable service capability.

## File Operation Commands

### abx upload

Upload a local file or directory to the sandbox.

```bash
abx upload <SANDBOX_ID> <LOCAL_PATH> <REMOTE_PATH>
```

```bash
abx upload abc123 ./script.py /app/script.py
abx upload abc123 ./data/ /app/data/
```

On an interactive terminal a directory upload shows `Uploading ... 12s` with each relative path in grey underneath. File contents are not printed. `--json`, `--quiet`, CI, and non-TTY print only the success line.

### abx download

Download a file from the sandbox to local.

```bash
abx download <SANDBOX_ID> <REMOTE_PATH> <LOCAL_PATH>
```

```bash
abx download abc123 /app/result.csv ./result.csv
abx download abc123 /app/output.log .
```

On an interactive terminal the transfer shows `Downloading <path>... 12s`. The file bytes are not printed.

---

## Named Commands

There is exactly one mechanism: commands registered on the **in-sandbox server** (`CommandRegistry` of the `SandboxServer`, served at `GET /commands` and `POST /commands/{name}`). They are not declared in `template.yaml`. A sandbox without a running server reports `No SandboxServer reachable` and exits non-zero.

### abx sandbox command list

```bash
abx sandbox command list <SANDBOX_ID> [--server-port PORT]
```

Lists the registered commands with their arguments and description.

### abx run

Same as `abx sandbox command run`.

```bash
abx run <SANDBOX_ID> <COMMAND_NAME> [options]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--arg` | `-a` | Argument `KEY=VALUE` (repeatable; the server coerces strings by the declared type) |
| `--json-args` | | Arguments as a JSON object (typed values) |
| `--server-port` | | Port of the in-sandbox server (default: 9000) |

```bash
abx sandbox command list abc123
abx run abc123 build --arg target=staging --arg n=2
abx run abc123 add --json-args '{"x": 1, "y": 2}'
```

Register a command with the decorator inside the sandbox:

```python
from agent_sandbox.server.registry import registry

@registry.command("greet")
def greet(name: str) -> str:
    return f"Hello, {name}!"

registry.freeze()
```

A string result is printed as is, any other value as JSON (`--json` wraps it as `{"result": ...}`). A command that fails on the server exits 1; an unknown name exits 2 (`CommandNotFoundError`).

---

## Configuration Commands — abx config

Manage persistent credentials and CLI defaults. Values are stored in `~/.abx/config.toml` and `~/.abx/.env`. Environment variables can still override stored configuration at runtime.

### abx config get

```bash
abx config get <KEY>
```

Available config keys:

| Key | Description |
|-----|-------------|
| `sandbox_api_key` | Sandbox service API key (stored in `~/.abx/.env` as `ABX_SANDBOX_API_KEY`, shown masked) |
| `access_key_id` | Alibaba Cloud AccessKey ID (template deploy, ACR push) |
| `access_key_secret` | Alibaba Cloud AccessKey Secret (shown masked) |
| `acr_namespace` | ACR namespace for template build, push, and install (stored as `ACR_NAMESPACE`) |
| `api_url` | Platform API URL |
| `domain` | envd data-plane domain |
| `region` | Default region |
| `http_timeout` | HTTP request timeout in seconds |
| `http2` | Enable HTTP/2 (true/false) |
| `llm_api_key` | LLM API key for NL inference and the coding agent (shown masked; stored as `ABX_LLM_API_KEY`) |
| `llm_model` | LLM model name (default: `qwen3-coder-plus`) |
| `llm_base_url` | LLM API base URL, OpenAI-compatible (default: DashScope compatible-mode) |
| `github_token` | GitHub token for template downloads (`abx template install` / `abx template search`; stored in `~/.abx/.env`, mapped to `GITHUB_TOKEN`, shown masked) |

### abx config init

Guided setup. The default asks only for the **credentials and the region**; `--build` and `--llm` add sections.

```bash
abx config init                 # sandbox API key + region
abx config init --build         # + ACR namespace and Alibaba Cloud AccessKey (template build / push / deploy / install)
abx config init --llm           # + LLM API key (template generation)
abx config init --yes           # Non-interactive: print the equivalent abx config set commands
```

- Interactive terminals prompt in order; sensitive values (API keys and the AccessKey secret) are typed with asterisk feedback (one `*` per character, never echoed) when the terminal supports it — otherwise a no-echo fallback is used with an explicit notice. Press Enter to skip a prompt. Secrets are stored in `~/.abx/.env` (`ABX_SANDBOX_API_KEY`, `ABX_LLM_API_KEY`, `ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET`); the ACR namespace is stored there as `ACR_NAMESPACE`; the region is written to `~/.abx/config.toml`.
- Features that need a setting you have not made (ACR namespace, AccessKey, LLM key) print a one-line pointer to `abx config init --build` or `abx config init --llm`, and `config init` itself ends with the same pointer for the sections it skipped.
- Enter accepts the current value / skips the prompt, Backspace edits, and Ctrl-C / EOF (Ctrl-D) abort the wizard cleanly.
- Non-TTY environments (CI, piped input), `--yes` and `--ci` never block: they print the equivalent non-interactive `abx config set` commands and exit 0.

```bash
abx config init --build --llm
# 1/6 Sandbox API key (sandbox_api_key / ABX_SANDBOX_API_KEY, input masked)
# 2/6 Region (default cn-hangzhou)
# 3/6 ACR namespace (needed by abx template install / build / deploy)
# 4/6 Alibaba Cloud AccessKey ID (template deploy / ACR push)
# 5/6 Alibaba Cloud AccessKey Secret (input masked)
# 6/6 LLM API key (DashScope/ModelStudio, input masked)
```

### abx config set

```bash
abx config set <KEY> <VALUE>
```

Settings are stored in `~/.abx/config.toml`, except credentials (`sandbox_api_key`, `access_key_id`, `access_key_secret`, `acr_namespace`, `llm_api_key`, `github_token`) which are written to `~/.abx/.env` (chmod 600).

Passing an empty `<VALUE>` clears the stored value for `KEY` instead: the key falls back to its built-in default or becomes not set. An empty string is never stored as a credential or as an override. When an environment variable still overrides the key at runtime, the command says so explicitly (without printing its value).

In an interactive terminal `<VALUE>` may be omitted: sensitive keys (`github_token`, `sandbox_api_key`, `access_key_secret`, `llm_api_key`) are then read through the masked (asterisk) input and the typed value is never echoed, while other keys use a visible prompt. Pressing Enter at the prompt cancels without changing anything; non-interactive sessions must pass `<VALUE>` explicitly (exit code 2 with the equivalent command otherwise).

```bash
abx config set sandbox_api_key YOUR_API_KEY
abx config set access_key_id YOUR_ACCESS_KEY_ID
abx config set acr_namespace YOUR_ACR_NAMESPACE
abx config set region cn-hangzhou
abx config set http_timeout 120
abx config set region ""        # clear the stored region (falls back to default)
abx config set sandbox_api_key ""       # remove the stored API key (becomes not set)
abx config set github_token            # masked prompt (VALUE omitted, interactive terminal)
abx config set github_token YOUR_GITHUB_TOKEN
abx config set github_token ""         # remove the stored token
```

### abx config list

```bash
abx config list
```

List all effective configuration values and their sources: `(env)` a process environment variable, `(user)` a value in `./.env` or stored with `abx config set`, `(default)` a built-in default, and `(not set)` when no value exists anywhere. A set environment variable wins over either file. `./.env` wins over `~/.abx` for a key it sets. See [Credential resolution](configuration.md#credential-resolution). Keys with a real business default (e.g. `llm_base_url`, `llm_model`) show the concrete default; `llm_api_key` and `sandbox_api_key` show `(not set)` when absent. Sensitive values are always masked.

### abx config delete

```bash
abx config delete <KEY>
```

Remove one stored value. The key falls back to its built-in default or becomes not set. `abx config set KEY ""` does the same thing. An environment variable that still overrides the key is left alone and named in the output, without printing its value. This does not delete `~/.abx` or every key at once; there is no `abx config reset`.

```bash
abx config delete acr_namespace
abx config delete access_key_secret
```

---

## Template Commands — abx template

Discover, scaffold, build, and manage sandbox templates.

### abx template scaffold

Scaffold a new sandbox template project from a built-in case, from a natural-language description, or from an existing project (`--adopt`). None of these paths builds, pushes, deploys, or creates a sandbox.

```bash
abx template scaffold [DIRECTORY] [options]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--template` | `-t` | Built-in scaffold case (`python`, `node`, `minimal`) |
| `--from` | | Fetch template source from a registry ref. A local directory with no `template.yaml` is rejected; use `--adopt` |
| `--name` | | Template name |
| `--list` | | List available scaffold cases |
| `--force` | | Overwrite existing files. With `--adopt` and `--yes`, also required to replace an existing Dockerfile |
| `--adopt` | | Adapt an existing project in DIRECTORY (default `.`): Qwen Code adds the template files |
| `--hint` | | With `--adopt`: ports, services, anything the code does not say |
| `--dry-run` | | With `--adopt`: list every file that would be sent. Nothing is sent or written |
| `-v` / `--verbose` | | Debug logging |
| `--yes` | `-y` | Skip confirmation. Required for non-interactive template generation, including `--adopt` |

**DIRECTORY behaviour**: when omitted, a new subdirectory `./<name>` is created. `<name>` is resolved by priority: `--name` > scaffold case name > fetched template name > generated name.

A path token (`my-app`, `./my app`) is a directory. Whitespace or CJK text is a description: Qwen Code writes `Dockerfile` + `template.yaml` into `./<name>/` and stops. An interactive terminal asks `Directory for the template project` first; Enter keeps `./<name>/` (or `./<--name>/` when `--name` is set), and any other path is the project directory itself. `--yes`, `--json`, and a non-interactive shell skip the question. That is the same result as answering yes to the switch question on `abx create --prompt "DESCRIPTION"` (the switch does not ask again; it writes `./<name>/`).

```bash
abx template scaffold --list
abx template scaffold -t python
abx template scaffold -t python --name myapp
abx template scaffold -t python ./my-template
abx template scaffold --from owner/repo
abx template scaffold --prompt "a python data science env"
abx template scaffold -y --prompt "a node.js api server"
abx template scaffold --adopt . --hint "listens on 8080"
abx template scaffold --adopt ./app --dry-run
abx template scaffold --adopt ./app -y          # non-interactive; then abx deploy ./app
```

`--adopt` copies candidate files to a temp directory and asks before sending them to the model. Secrets (`.env`, keys, secret-looking files) are left out of that copy. The agent cannot modify the project: only `Dockerfile`, `commands.py`, `template.yaml` and, when you don't already have one, a generated `.dockerignore` are written, and only after a second confirmation (or `--yes`). Replaced files are kept as `*.abx-bak`. The model process does not inherit cloud credentials (`ALICLOUD_*`, `E2B_*`, `ACR_*`, …). This shows the model your project source; it is a larger exposure than `abx template scaffold --prompt "DESCRIPTION"`, which only sends the sentence you typed.

> Guided credentials setup is `abx config init`; there is no top-level `abx init`.
>
> Unknown top-level commands produce a targeted hint: a close spelling match gets a `Did you mean '…'?` suggestion; otherwise the error points to the command list (`abx --help`), `abx template scaffold|install`, and `abx run SANDBOX NAME` for named commands.

### abx template deploy

Build, push, and create template in one step (alias of `template build`).

> **Cloud side effects & costs**: the ACR push and the remote template registration are cloud-side operations that can incur Alibaba Cloud costs (ACR storage/traffic, template resources). An interactive confirmation (or `--yes`) is required before any cloud operation starts; non-interactive sessions fail fast instead of deploying silently.

Requires: Docker daemon running, ACR credentials, and an ACR namespace. AK/SK credentials are read from `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET` when `--acr-username`/`--acr-password` are omitted.

```bash
abx template deploy <TEMPLATE_DIR> [options]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--acr-registry` | | ACR registry host |
| `--acr-namespace` | | ACR namespace (CLI > env `ACR_NAMESPACE` > `.env`) |
| `--acr-repo` | | ACR repository name (defaults to `template.yaml` name or dir name) |
| `--acr-username` / `--acr-password` | | ACR credentials |
| `--acree-instance-id` | | ACR EE instance ID |
| `--vpc-id` | | VPC ID |
| `--vswitch-ids` | | Comma-separated VSwitch IDs |
| `--security-group-id` | | Security group ID |
| `--alias` | `-a` | Template alias |
| `--tag` | `-t` | Docker image tag |
| `--platform` | | Target platform |
| `--cpu` | | CPU cores (default: `template.yaml` → 2) |
| `--memory` | | Memory in MB (default: `template.yaml` → 2048) |
| `--start-cmd` / `--ready-cmd` | | Start/readiness command |
| `--timeout` | | Build timeout in seconds |
| `--dockerfile` | `-f` | Custom Dockerfile path |
| `--disk-size` | | Disk size in MB (official API only) |
| `--internet-access/--no-internet-access` | | Internet access (official API only) |
| `--team-id` | | Team ID |
| `--envd-inject/--no-envd-inject` | | envd injection (default off) |
| `--generation` | | Sandbox generation (1=first-gen rund, 2=second-gen MicroVM; default: `template.yaml` → 1) |
| `--target-image` | | Destination image ref for envd copy |
| `--yes` | `-y` | Skip confirmation |
| `--verbose` | `-v` | Verbose output |
| `--region` | `-r` | Region override for this command (default: `abx config set region` value, else `cn-hangzhou`) |

```bash
abx template deploy ./examples/templates/python-hello \
  --acr-namespace my-ns --acr-repo python-hello

abx template deploy ./my-template --acr-namespace prod --yes
```

#### Parameter Defaults & Priority

Parameters for `template build` / `template deploy` are resolved through a **5-level priority chain** (highest first):

| Priority | Source |
|----------|--------|
| 1 | Explicit CLI flag |
| 2 | OS environment variable |
| 3 | `.env` file in the current working directory |
| 4 | `template.yaml` in the template directory |
| 5 | Hardcoded fallback |

> **Automation / CI**: pass `--acr-namespace` and the template directory explicitly on the command line instead of relying on `ACR_NAMESPACE` / `ABX_DEFAULT_TEMPLATE_DIR` environment variables or a `.env` file, so builds cannot silently drift with the surrounding environment. For `template install` / `install`, either pass `--acr-namespace` explicitly or use `--download-only` when the pipeline must not touch the cloud at all.

### abx template build

Build Docker image locally, push to ACR, and create a sandbox template.

> **Cloud side effects & costs**: the default pipeline is local Docker build → ACR push → template registration via the official CreateTemplate API. The ACR push and the remote registration are cloud-side operations that can incur Alibaba Cloud costs (ACR storage/traffic, template resources). An interactive confirmation (or `--yes`) is required before the cloud operations start.

Supports two modes: `--official-api` (default, requires AK/SK and the bundled `@alicloud/fcsandbox20260509` client) and `--legacy-api` (legacy v3/v2 platform API — kept behind an explicit flag, not the default). The old command name `abx template build-local` was removed before `0.1.0`; it is replaced by `abx template build` (same pipeline, same options).

```bash
abx template build <TEMPLATE_DIR> [options]
```

Parameters are the same as `template deploy`.

### abx template push

Push a locally-built image to Alibaba Cloud ACR.

```bash
abx template push <IMAGE> [options]
```

| Option | Description |
|--------|-------------|
| `--acr-registry` | ACR registry host |
| `--acr-namespace` | ACR namespace |
| `--acr-username` / `--acr-password` | ACR credentials |
| `--acree-instance-id` | ACR EE instance ID |
| `--region` | Region override for this command (default: `abx config set region` value, else `cn-hangzhou`) |

```bash
abx template push python-hello:latest --acr-namespace my-ns
```

### abx template from-image

Create a sandbox template from an existing container image. Uses the official Alibaba Cloud FCSandbox CreateTemplate API (requires AK/SK and the bundled `@alicloud/fcsandbox20260509` client).

```bash
abx template from-image <IMAGE> --name <NAME> [options]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--name` | `-n` | Template name (required) |
| `--team-id` | | Team ID |
| `--cpu` | | CPU cores (default 2, FLOAT) |
| `--memory` | | Memory in MB (default 2048) |
| `--disk-size` | | Disk size in MB |
| `--internet-access/--no-internet-access` | | Internet access |
| `--generation` | | Sandbox generation |
| `--envd-inject/--no-envd-inject` | | envd injection |
| `--target-image` | | Destination image ref for envd copy |
| `--registry-type` | | Registry type: `acr` / `acree` (auto-detected) |
| `--acree-instance-id` | | ACR EE instance ID |
| `--registry-username` | | Registry login username |
| `--registry-password` | | Registry login password |
| `--start-cmd` | | Container start command |
| `--ready-cmd` | | Container readiness check command |
| `--region` | `-r` | Region override for this command (default: `abx config set region` value, else `cn-hangzhou`) |

```bash
abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-template

abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \
  --name my-tpl --cpu 4 --memory 4096 --disk-size 10240 --internet-access
```

On an interactive terminal the CreateTemplate call shows `Creating template <name>... 12s`. The registry password is not printed.

### abx template install

Download a template and (by default) build + deploy it. Use `--download-only` to skip the build/deploy step and only download to the local cache (`~/.abx/templates/`). Use `--dir` to download to a custom directory.

By default the build + deploy step performs a local Docker build, an ACR push, and a CreateTemplate registration — cloud-side operations that can incur Alibaba Cloud costs (ACR storage/traffic, template resources); `--download-only` skips them entirely. An interactive confirmation (or `--yes`) is required before the cloud operations start; non-interactive sessions fail fast with a `--download-only` hint when prerequisites are missing.

`TEMPLATE_REF` is either a **bare template name** from the remote index (published by the source-of-truth repository `alibaba-agent-sandbox/awesome-templates`) or a registry reference (`owner/repo[//subdir][@ref]`). Bare-name resolution order: local path → builtin (`base` / `code-interpreter-v1`, no network) → remote index (on a hit it prints `Resolved '<name>' via the template index: ...`). Entries may pin a version via `ref`, and the pin is honoured; a missed bare name triggers one forced index refresh, so a freshly published template never waits for the cache TTL.

```bash
abx template install <TEMPLATE_REF> [options]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--registry-url` | | Registry URL (default: GitHub) |
| `--registry-type` | | `github` / `local` (auto-detected) |
| `--token` | | GitHub token: private-repo access + higher rate limits for the remote index (env: `GITHUB_TOKEN`). Temporary override only — prefer `abx config set github_token`; `--token` may leak into shell history and process listings |
| `--alias` | `-a` | Template alias |
| `--download-only` | | Only download to local cache (skip build and deploy) |
| `--dir` | | Download to a custom directory |
| `--acr-namespace` | | ACR namespace for deploy |
| `--cpu` | | CPU cores |
| `--memory` | | Memory in MB |
| `--yes` | `-y` | Skip confirmation prompt |
| `--region` | `-r` | Region override for this command (default: `abx config set region` value, else `cn-hangzhou`) |

```bash
abx template install owner/repo --acr-namespace my-ns    # Download + build + deploy
abx template install owner/repo --download-only          # Download only
abx template install owner/repo//subdir --dir ./local    # Subdirectory + custom path
abx template install node-web --download-only            # Bare name resolved via the remote index
abx template install alibaba-agent-sandbox/awesome-templates//node-web@v1.0.0 --download-only  # Pin a version
```

Token resolution order: `--token` > process `GITHUB_TOKEN` > `./.env` > stored `github_token` (`abx config set github_token`; masked input, stored in `~/.abx/.env`) > no token. On an anonymous GitHub rate limit (E5000) the full `owner/repo//subdir@ref` reference is preserved in the error — including subdirectory and pinned ref — together with the officially documented fine-grained PAT prefill URL (public repositories need no extra permissions; 90-day expiry recommended). In an interactive terminal only, the CLI offers a masked one-shot `github_token` setup and retries the failed operation **exactly once**; CI / non-interactive sessions are told to inject `GITHUB_TOKEN` as a secret or to run `abx config set github_token` in a terminal. The token is never printed or logged.

### abx template init

<a id="abx-template-create"></a>
<a id="abx-template-list"></a>

`template init --name demo --language python-sync` (or python-async) generates local SDK files. `template create` retains standard Dockerfile-build behavior. `template list --format json` retains standard model/output; actual build/list permissions and Alibaba capability limits apply. Project image registration uses `template from-image`, and template.yaml/server generation uses `template scaffold`.

### abx template info

Show details for a template ID. Pass `--official-api` to use the Alibaba Cloud FCSandbox GetTemplate API.

```bash
abx template info <TEMPLATE_ID> [options]
```

| Option | Description |
|--------|-------------|
| `--official-api` | Query via the official Alibaba Cloud FCSandbox API (AK/SK) |
| `--region` | Region override for this command (default: `abx config set region` value, else `cn-hangzhou`) |

### abx template delete

Use the standard command's --help for its fixed confirmation/options. For Alibaba image administration through the project extension envelope, `abx --json template delete <id> --yes` retains that explicitly selected project interface. Deleting templates/snapshots remains subject to backend ownership and occupancy rules.

### abx template search

Search templates by name, tag, or description against the `awesome-templates.yaml` index published by the source-of-truth repository [`alibaba-agent-sandbox/awesome-templates`](https://github.com/alibaba-agent-sandbox/awesome-templates). The index is cached under `~/.abx/index/` (1-hour TTL; a fresh cache makes no network call); on network failures / rate limits it falls back to the stale cache with a warning. Without a cache, an anonymous rate limit (E5000) reports the unified guidance — `abx config set github_token` / `GITHUB_TOKEN`, the fine-grained PAT prefill URL, the `--token` leak warning, and a mirror hint — and an interactive terminal is offered a masked one-shot `github_token` setup followed by exactly one automatic retry (never a loop). Non-interactive sessions are pointed at secret injection or an interactive `abx config set github_token`.

```bash
abx template search <QUERY> [options]
```

| Option | Short | Description |
|--------|-------|-------------|
| `--tag` | `-t` | Filter by exact tag name |
| `--status` | `-s` | Filter by status: `official` / `community` / `experimental` |
| `--index-url` | | Index location: HTTP(S) URL or local file path (env: `ABX_DEFAULT_TEMPLATE_INDEX_URL`; default: the canonical remote index) |
| `--token` | | GitHub token for private mirrors / higher rate limits (env: `GITHUB_TOKEN`). Temporary override only — prefer `abx config set github_token` |
| `--refresh` | | Force a re-fetch of the index, ignoring the local cache |

```bash
abx template search python
abx template search browser --status official
abx template search qwen --tag deploy
abx template search python --refresh              # Bypass the local cache
abx template search web --index-url https://mirror.example/idx.yaml  # Private mirror
```

---

## MCP Commands — abx mcp

Configure and run Agent Sandbox as an MCP server. Supports local STDIO transport (IDE integrations) and Streamable HTTP deployment artifact (manual FC deployment).

### abx mcp install

Install MCP Server configuration to a target IDE.

```bash
abx mcp install --target <cursor|claude|vscode>
```

| Option | Description |
|--------|-------------|
| `--target` | Target IDE (`cursor` / `claude` / `vscode`, required) |

### abx mcp start

Start the local MCP server. The default transport is STDIO: notes, configuration, and how to stop go to stderr, and stdout is JSON-RPC only. The process waits on stdin; that wait is the running state. Stop it with Ctrl-C or `abx mcp stop`. `--background` detaches an HTTP server (STDIO cannot keep serving after detach).

```bash
abx mcp start [options]
abx mcp start --http --background
```

| Option | Description |
|--------|-------------|
| `--template` | Default sandbox template (default: `code-interpreter-v1`) |
| `--api-key` | API Key override |
| `--api-url` | API URL override |
| `--domain` | Domain override |
| `--http` | Serve Streamable HTTP instead of STDIO |
| `--host` | HTTP bind address (default `127.0.0.1`). A non-loopback host requires a non-empty `--auth-token` |
| `--port` | HTTP port (default `9000`) |
| `--auth-token` | HTTP Bearer token (env `ABX_MCP_AUTH_TOKEN`) |
| `--background` | Detach the HTTP server; stop it later with `abx mcp stop` |

### abx mcp stop

Stop the local process recorded by `abx mcp start` (foreground STDIO or background HTTP). Sends SIGTERM to that pid and waits for it to exit. When nothing is running, prints `MCP server is not running.`

```bash
abx mcp stop
```

### abx mcp status

Show MCP tools, authentication state, whether the local server is running (`mcp_running`), and IDE installation status.

```bash
abx mcp status
```

### abx mcp deploy

Generate an Alibaba Cloud FC deployment artifact (Streamable HTTP ASGI). Does not call the FC deployment API.

`POST /mcp` handles requests and `DELETE /mcp` terminates a session. `GET /mcp` returns 405 until SSE server notifications exist. Deploy requires a non-empty Bearer token.

```bash
abx mcp deploy [options]
```

| Option | Description |
|--------|-------------|
| `--name` | FC function name (default: `agent-sandbox-mcp`) |
| `--region` | FC region (command `--region` > `ALIBABA_CLOUD_REGION_ID` > `abx config set region` > `cn-hangzhou`) |
| `--template` | Default sandbox template |
| `--memory` | FC function memory in MB |
| `--timeout` | FC function timeout in seconds |
| `--auth-token-file` | Path to a Bearer token file |
| `--generate-token` | Auto-generate a random Bearer token |
| `--enable-session-affinity/--no-session-affinity` | Mcp-Session-Id affinity (default: enabled) |
| `--api-key` | ABX_SANDBOX_API_KEY to inject into FC function env |
| `--custom-domain` | Custom domain for the MCP endpoint |
| `--output-dir` | Write the deployment artifact to this directory |

```bash
abx mcp deploy --generate-token --api-key $ABX_SANDBOX_API_KEY --output-dir ./deploy-artifact
abx mcp deploy --auth-token-file ./token.txt --region cn-shanghai --output-dir ./artifact
```

---

## Deploy Command — abx deploy

Publish a template project: `docker build` → push to ACR → register the template → wait until ready. Fixed pipeline; **no description, no LLM, no LLM key**. It is step 2 of the template lifecycle (`abx template scaffold` → **`abx deploy`** → `abx create <template>`); what the template is lives in `template.yaml`.

```bash
abx deploy [PATH] [options]
```

`PATH` is the template directory (default: `.`). It must contain a `Dockerfile` unless `--dockerfile` is given. `template.yaml` supplies `name` (ACR repository), `resources.cpu`, `resources.memory` and `generation`; options override it.

`abx deploy` accepts **every option of `abx template deploy`** (`--acr-registry`, `--acr-namespace`, `--acr-repo`, `--alias -a`, `--tag -t`, `--cpu`, `--memory`, `--dockerfile -f`, `--yes -y`, `--verbose -v`, `--region -r`, ...; see `abx deploy --help`).

```bash
abx template scaffold --prompt "a python data science env"   # 1. author (AI optional)
abx deploy ./<name> --acr-namespace my-ns       # 2. publish
abx create <TEMPLATE_ID>             # 3. launch
```

There is no instruction argument or `--agent` flag: describe the template once, when you author it.

---

## sandbox Subcommand Group

`abx sandbox` is the canonical home of the sandbox operations (create / list / info / kill / exec / connect / upload / download / capabilities); the top-level `abx create` … `abx download` are fixed shortcuts for them. The subgroups below exist only here.

### abx sandbox files — File Operations

| Subcommand | Description | Main Options |
|------------|-------------|--------------|
| `list` | List directory contents | `--path -p`, `--recursive -r` |
| `stat` | Get file/directory info | `--path -p` (required) |
| `mkdir` | Create directory (including parents) | `--path -p` (required) |
| `rm` | Delete file/directory | `--path -p` (required), `--yes -y` |
| `mv` | Move/rename | `--source -s` (required), `--dest -d` (required) |
| `search` | Search by glob pattern | `--path -p` (required), `--pattern` (required), `--max-depth` (default 5) |

```bash
abx sandbox files list abc123 --path /app --recursive
abx sandbox files stat abc123 --path /app/main.py
abx sandbox files mkdir abc123 --path /app/data
abx sandbox files rm abc123 --path /app/temp.log --yes
abx sandbox files mv abc123 --source /app/old.py --dest /app/new.py
abx sandbox files search abc123 --path /app --pattern "*.py"
```

### abx sandbox process — Process Inspection

Process IDs returned by standard background execution may be envd handles rather than OS PIDs. The project process info extension resolves listed handles through envd first and reports its known PID/command/state; OS-only fields are not invented. Unlisted OS PIDs retain the ps fallback.


Inspect and control processes; to start one, use `abx exec --background` (prints the pid).

| Subcommand | Description | Main Options |
|------------|-------------|--------------|
| `list` | List running processes | — |
| `info` | Get process details by PID | `PID` |
| `signal` | Send signal to process | `PID` (the envd process id from `process list`), `--signal -s` (default 15/SIGTERM; only 15 and 9/SIGKILL are supported, any other number is rejected before a request is sent) |

```bash
abx sandbox process list abc123
abx sandbox process info abc123 1234
abx sandbox process signal abc123 1234 --signal 9
```

### abx sandbox system — System Information

| Subcommand | Description | Main Options |
|------------|-------------|--------------|
| `info` | System info (OS, CPU, memory, disk) | — |
| `env` | Environment variables (sensitive values auto-filtered) | `--filter -f` (comma-separated names) |
| `ports` | Listening TCP ports | — |
| `packages` | Installed packages (pip/npm) | `--manager -m` (default `pip`) |
| `metrics` | Resource usage (CPU load, disk usage) | — |

```bash
abx sandbox system info abc123
abx sandbox system env abc123 --filter PATH,HOME,LANG
abx sandbox system ports abc123
abx sandbox system packages abc123 --manager npm
abx sandbox system metrics abc123
```

### abx sandbox capabilities — Capability Group Status

Show the capability groups available in a sandbox (shell, files, code, terminal, ports). The built-in provider reads them from the sandbox template; a plugin provider derives them from the features it declares (`abx provider info <ID>`).

```bash
abx sandbox capabilities <SANDBOX_ID>
```

---

## Exit Codes

Standard exec returns the remote process status; standard parser/API errors follow the pinned E2B CLI (usually 1). The table below describes project extension errors, not standard E2B commands.


| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Argument error: bad or conflicting flags and arguments, including checks a command makes after parsing (for example `--yes` required without a terminal) |
| 3 | Authentication failure |
| 4 | Resource not found |
| 5 | Timeout |
| 6 | Quota exceeded |
