# CLI Tutorial

This tutorial walks you through mastering the `abx` CLI step by step, covering the complete sandbox lifecycle, template usage, and MCP integration.

---

## Step 1: Installation

```bash
# Build this checkout until the new release is published
npm ci
npm run build
node dist/bin/abx.js --version
```

Examples below use the installed binary name abx. From this checkout, replace that prefix with `node /absolute/path/dist/bin/abx.js`:

```bash
abx --version
```

---

## Step 2: Authentication

### Set API Key via config

```bash
abx config set sandbox_api_key your-api-key
```

### Or via Environment Variable

```bash
export ABX_SANDBOX_API_KEY="your-api-key"
```

> For more authentication methods (AK/SK, .env files, config.toml, etc.), see [Authentication](authentication.md).

---

## Step 3: Create a Sandbox

The standard Express commands follow the [fixed E2B contract](migrate-from-e2b.md). The positional argument is a template, defaulting to base. For the remaining steps create a detached sandbox and retain its printed ID:

```bash
abx create base --detach --timeout 300
```

Without --detach create opens a real PTY; its default exit policy shortens the lease (Alibaba minimum TTL applies). For an existing sandbox, connect opens a PTY and leaves that sandbox alive after terminal exit.

Natural language is an explicit project extension:

```bash
abx create --prompt "a Python data analysis environment"
abx create --prompt "a Node.js API server" -y
abx template scaffold --prompt "a Python data analysis environment"
```

The project generation path may research requirements and ask for missing user choices, then build/deploy after confirmation. The scaffold command writes local files. `template init --name demo --language python-sync` instead generates standard SDK build files; Python output imports agent_sandbox. Existing template creation needs neither LLM nor --template. Upload files separately:

```bash
abx upload <sandbox-id> ./project /home/user/project
```

## Step 4: View and Manage Sandboxes

```bash
abx list --state running --limit 5 --format json
abx info <sandbox-id> --format json
```

Standard output uses E2B models and --format; the project's global JSON envelope is a separate extension interface. Keep E2B_API_KEY, E2B_API_URL and E2B_DOMAIN configured.

## Step 5: Execute Commands in a Sandbox

```bash
abx exec <sandbox-id> echo Hello World
abx exec --cwd /tmp --env MODE=test <sandbox-id> sh -c 'printf "$MODE"; exit 7'
abx exec --background <sandbox-id> python -m http.server 8000
abx connect <sandbox-id>
```

Local options precede the sandbox ID. All later flags belong to the remote command. Output streams by default; a foreground command returns its remote exit code, and a background PID is written to stderr. The fixed version has no local --timeout or --stream. Connect uses a real terminal with persistent cwd and environment. EOF-dependent piped stdin requires backend support, as described in the migration guide.

---

## Step 6: File Operations

### Upload

```bash
abx upload sbx-xxxx ./script.py /app/script.py
abx upload sbx-xxxx ./data/ /app/data/
```

On a terminal a directory upload shows `Uploading ... 12s` and the relative paths in grey. The file bytes are not printed.

### Download

```bash
abx download sbx-xxxx /app/result.csv ./result.csv
```

On a terminal the transfer shows `Downloading /app/result.csv... 12s`. The file bytes are not printed.

---

## Step 7: Run Named Commands

Named commands are registered in Python code running inside the sandbox (the in-sandbox `SandboxServer`). They are not declared in `template.yaml`.

```python
from agent_sandbox.server.registry import registry

@registry.command("greet")
def greet(name: str) -> str:
    return f"Hello, {name}!"

registry.freeze()
```

List and run them:

```bash
abx sandbox command list sbx-xxxx
abx run sbx-xxxx greet --arg name=World          # same as: abx sandbox command run
abx run sbx-xxxx add --json-args '{"x": 1, "y": 2}'
```

> `registry` belongs to the in-sandbox server SDK, which is documented in the SDK repository (see [Related SDK documentation](#related-sdk-documentation)). A sandbox without a running server reports `No SandboxServer reachable`.

---

## Step 8: Destroy a Sandbox

```bash
abx kill <sandbox-id>
```

Standard kill has no confirmation or --yes flag. --all deletes every selected running sandbox immediately; use IDs or narrow state/metadata filters for cleanup. Conditional pause/snapshot operations require enabled functions and supported runtimes/accounts.

---

## Using Templates

### Install Templates from GitHub

```bash
abx template install owner/repo
abx template install owner/repo@v1.0
abx template install owner/repo//subdir
```

### Use an Installed Template

```bash
abx create my-template --detach
```

### Scaffold a Template Locally

```bash
# Create ./python/ from the built-in 'python' case
abx template scaffold -t python

# Or scaffold into an explicit directory
abx template scaffold -t python ./my-template
```

Guided credentials setup is `abx config init`; there is no top-level `abx init`.

#### Adapt an existing project

```bash
# Qwen Code adds Dockerfile, commands.py and template.yaml to ./my-app
abx template scaffold --adopt ./my-app --hint "listens on 8080"

# List what would be sent. No model call, no files written
abx template scaffold --adopt ./my-app --dry-run

# Then publish (no LLM)
abx deploy ./my-app --acr-namespace my-ns
```

`--adopt` copies the project to a temp directory first. `.env`, keys and secret-looking files stay out of that copy, and only the template files are written back after a preview. A non-interactive shell needs `-y`. Details: [Authoring Templates](authoring-templates.md#adapt-an-existing-project).

#### Interactive case selection

- **TTY**: running `abx template scaffold` without `-t` shows an arrow-key (Up/Down) selector over the built-in cases; `Enter` confirms, `Ctrl+C` aborts without writing anything.
- **Non-TTY / CI / `--json`**: the selector never blocks — the command fails fast with the list of valid cases (use `-t python|node|minimal` or `--list`), keeping scripts deterministic.

#### The fixed top-level shortcuts

`abx --help` lists a fixed set of shortcuts under **Sandbox shortcuts**: `create`, `list`, `info`, `kill`, `exec`, `connect`, `upload`, `download`, `run` and `deploy`. Each is documented as "Same as 'abx …'" (`abx create` = `abx sandbox create`, `abx run` = `abx sandbox command run`, `abx deploy` = `abx template deploy`). They are hard-coded: there is no configuration for them, and no top-level `init` or `install`.

Unknown top-level commands get targeted hints: `abx crate` → `Did you mean 'create'?`; with no close match the error points to `abx --help`, `abx template scaffold|install` and `abx run SANDBOX NAME`. See the [CLI command reference](../reference/cli-commands.md) for the full tree.

### One-Click Deploy Custom Templates

```bash
abx template deploy ./my-template \
  --acr-namespace my-ns --acr-repo my-template
```

`template deploy` automatically performs: local Docker build → ACR push → CreateTemplate API call. On a terminal each of those steps is a moving `message... 12s` header with the latest six log lines in grey underneath. See [While a command is running](#while-a-command-is-running), and [Authoring Templates](authoring-templates.md) for the template files.

---

## Configuration Management

```bash
# View configuration
abx config list
abx config get sandbox_api_key

# Set configuration
abx config set region cn-beijing
abx config set http_timeout 60

# Clear one stored value (returns to default / not set)
abx config set region ""
```

Available configuration keys: `sandbox_api_key`, `api_url`, `region`, `http_timeout`, `max_retries`, `domain`, `llm_api_key`, `llm_model`, `llm_base_url`, `github_token`, `access_key_id`, `access_key_secret`, `acr_namespace`. `api_key` is still accepted as an alias of `sandbox_api_key`.

> **Tip:** hit a GitHub anonymous rate limit while using `abx template search` / `abx template install`? Run `abx config set github_token` in an interactive terminal (masked input, stored in `~/.abx/.env`), or inject `GITHUB_TOKEN` as a CI secret. See [Authentication](authentication.md) and the CLI reference for the `--token` precedence notes.
>
> **Local pre-CI check:** run `make ci` before pushing — it mirrors the GitHub Actions pipeline (typecheck, build, non-integration tests, parity coverage check) on a single local Node.js version.

---

## MCP Integration

Use Agent Sandbox as a local STDIO MCP Server for AI IDEs. STDIO mode does not require the HTTP transport dependencies:

```bash
# Install to Cursor
abx mcp install --target cursor

# Install to Claude Desktop
abx mcp install --target claude

# View MCP status
abx mcp status

# Start manually: configuration goes to stderr, then it waits on stdin
abx mcp start --template code-interpreter-v1
# From another terminal: abx mcp stop
# Background HTTP: abx mcp start --http --background
```

### Remote MCP Server Deployment Artifact

Generate a Streamable HTTP MCP artifact for manual deployment to Alibaba Cloud FC. The command does not call an FC deployment API:

```bash
# Generate files with a new Bearer token
abx mcp deploy --generate-token --api-key $ABX_SANDBOX_API_KEY \
  --output-dir ./deploy-artifact
```

Install `agent-sandbox-client[mcp]` in the HTTP runtime. Then use the official Alibaba Cloud FC console or SDK to package the artifact and create the function and HTTP trigger. Treat `config.yaml` as a provider-neutral checklist—not an FC API payload—and translate its settings through the official interface. Replace the URL and token placeholders in the printed IDE template with the deployment values.

Clients should call `DELETE /mcp` when a session ends. `GET /mcp` returns 405 until SSE server notifications exist. `abx mcp deploy` refuses to write an artifact without a non-empty Bearer token. `config.yaml` may contain plaintext credentials, so do not commit the artifact or completed IDE configuration to version control.

---

## While a command is running

A step that can sit for a while draws one block on **stderr**:

```text
Building Docker image locally: my-template:latest... 12s
#5 [1/2] FROM ubuntu:22.04
#5 DONE 0.1s
```

The header's elapsed time moves about once a second, including while the tool is silent. The grey rows are the last six lines (`ABX_ACTIVITY_LINES`, from 1 to 10). Project extensions use this block for transfer, template/catalog operations, agent installation and deploy phases. Standard commands retain their pinned E2B output.

Grey rows include a short redacted tool detail (command, url, query, or path), along with relative paths, install milestones (mirror, checksum, extract), docker or poll lines, and `i/N <id>` while killing. File bytes, thinking, and credentials stay hidden. ACR tokens and `--build-arg` values are not shown.

`--json`, `--quiet`, `--ci`, `TERM=dumb`, and a non-TTY print no such header. Deploy still prints one progress line per phase in those modes. `--verbose` prints the full deploy log instead of the block; other commands keep the header on a terminal. Results stay on stdout.

## Global Options

Project extensions support --json/-j, --quiet/-q, --no-color, --verbose and --ci as documented by their help. Standard E2B commands retain their fixed options, such as list/info --format json. Use E2B_API_URL/E2B_DOMAIN for the standard endpoint; region flags apply only to project administration commands that explicitly offer them.

See [CLI Reference — Global Options](../reference/cli-reference.md#global-options).

## CI/CD Mode

Use detached creation and explicit standard JSON output in automation:

```bash
abx create base --detach --timeout 300
abx list --format json | jq '.[].sandboxId'
```

The project extension --ci flag selects its own JSON/quiet interface; it is not required to migrate an existing E2B CLI script. Keep remote exec arguments after the sandbox ID.

---

## Next Steps

- [Authentication](authentication.md) — Deep dive into authentication methods and configuration priority
- [Using Templates](using-templates.md) — Discover, install, and use templates
- [CLI Reference](../reference/cli-reference.md) — Complete reference for all commands

## Related SDK documentation

- [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) — Use Agent Sandbox in Python code
- [Server API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/server-api.md) — the in-sandbox server SDK behind `@registry.command` (Mechanism B)

