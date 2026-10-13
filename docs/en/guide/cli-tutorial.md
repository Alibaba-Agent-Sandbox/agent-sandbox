# CLI Tutorial

This tutorial walks you through mastering the `abx` CLI step by step, covering the complete sandbox lifecycle, template usage, and MCP integration.

---

## Step 1: Installation

```bash
npm install -g @agent-sandbox/cli
```

After installation, the `abx` command is available:

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

### Quick Orientation: `config init` vs `template init` vs `create`

| I want to... | Command |
|--------------|---------|
| Store credentials / endpoints (run first) | `abx config init` — guided interactive wizard |
| Create a cloud sandbox (default, existing template, or generated from a description) | `abx create [DESCRIPTION]` |
| Scaffold an editable local template project | `abx template init [DIRECTORY]` or `abx template init "DESCRIPTION"` — writes files only, no build or deploy. A description asks for the project directory first (Enter keeps `./<name>/`) |
| Turn an existing project into a template | `abx template init --adopt [DIRECTORY]` — adds the template files in place; no build or deploy |

### Using the Default Template

```bash
abx create --template base
# Output similar to:
# ✓ Sandbox created: sbx-xxxx
```

### Natural Language Creation (template generation)

```bash
# First run: credentials + region (`--build` adds ACR, `--llm` adds the LLM key used here)
# abx config init --llm --build

# Qwen Code generates Dockerfile + commands.py (HTTP server) + template.yaml → build & deploy → create sandbox.
# An interactive terminal first asks whether to switch to template init
# (local files only). --yes keeps the full pipeline.
abx create "a Python data analysis environment"

# Template files only — no build, push, deploy, or sandbox
abx template init "a Python data analysis environment"
```

Before generating, the agent first researches the publicly verifiable facts itself — whether the tool is Node.js-based, its official install method, common runtimes and dependencies — then assesses the description for completeness (target: 80%). Only user preferences, private constraints, and business decisions it cannot infer become questions, asked **one at a time** and numbered `Question 1`, `Question 2`, … with no total shown; press Enter to cancel:

```text
Description is about 40% complete. I'll ask for the missing details one question at a time — press Enter to cancel.
Question 1: Which region and resource size should the sandbox use?
```

Answers like "you decide" / "use the default" delegate the choice back to the agent (safe defaults apply), and already-answered topics are never asked again.

Non-interactive environments (CI, piped input) must pass `-y` to skip confirmations and the clarification assessment; otherwise the install/credential/build steps fail fast with a Quick Setup guide, and a description below the completeness threshold fails fast with `E2008` (missing details + a ready-to-use example description):

```bash
# abx create -y "a node.js api server"
# abx create "run python"    # non-interactive, incomplete → E2008
```

An explicit `--template` skips template generation and takes the direct template path (`abx create --template <name>`). `DESCRIPTION` and `--template` are mutually exclusive — passing both is rejected with a usage error instead of silently ignoring one of them:

```bash
# abx create "a node.js api server" --template base   # rejected (exit code 2)
```

### Upload Files on Creation

```bash
abx create --template base --upload ./project/ --env MY_KEY=value
```

---

## Step 4: View and Manage Sandboxes

### List All Sandboxes

```bash
abx list
abx list --status running
abx list --limit 5
```

### View Details

```bash
abx info sbx-xxxx
```

---

## Step 5: Execute Commands in a Sandbox

### Execute a Single Command

```bash
abx exec sbx-xxxx -- echo Hello World
abx exec sbx-xxxx --timeout 120 -- pip install flask
abx exec sbx-xxxx --stream -- pip install flask         # live output
abx exec sbx-xxxx --background -- python -m http.server 8000   # prints the pid
```

### Interactive Connection

```bash
abx connect sbx-xxxx
```

This is a line-based REPL, not a PTY or an SSH session: each line runs in its own
process with a 30-second timeout, so `cd`, environment variables and shell state
do not persist between lines (use `cd /path && <cmd>` on one line, or
`abx exec --cwd`). Interactive terminals get basic line editing and history
(Up/Down, Ctrl+R, Ctrl+A/E). Type `exit`, `quit`, or `Ctrl+D` to leave; `Ctrl+C`
also disconnects. Failed commands are reported as a single friendly message.

```text
abx:sbx-xxxx> ls /app
main.py  data/
abx:sbx-xxxx> cd /app && python main.py
Hello from main.py
abx:sbx-xxxx> exit
Disconnected.
```

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
# Destroy a single sandbox
abx kill sbx-xxxx

# Destroy all sandboxes (requires confirmation)
abx kill --all

# Skip confirmation
abx kill --all --yes
```

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
abx create --template my-template
```

### Scaffold a Template Locally

```bash
# Create ./python/ from the built-in 'python' case
abx template init -t python

# Or scaffold into an explicit directory
abx template init -t python ./my-template
```

Guided credentials setup is `abx config init`; there is no top-level `abx init`.

#### Adapt an existing project

```bash
# Qwen Code adds Dockerfile, commands.py and template.yaml to ./my-app
abx template init --adopt ./my-app --hint "listens on 8080"

# List what would be sent. No model call, no files written
abx template init --adopt ./my-app --dry-run

# Then publish (no LLM)
abx deploy ./my-app --acr-namespace my-ns
```

`--adopt` copies the project to a temp directory first. `.env`, keys and secret-looking files stay out of that copy, and only the template files are written back after a preview. A non-interactive shell needs `-y`. Details: [Authoring Templates](authoring-templates.md#adapt-an-existing-project).

#### Interactive case selection

- **TTY**: running `abx template init` without `-t` shows an arrow-key (Up/Down) selector over the built-in cases; `Enter` confirms, `Ctrl+C` aborts without writing anything.
- **Non-TTY / CI / `--json`**: the selector never blocks — the command fails fast with the list of valid cases (use `-t python|node|minimal` or `--list`), keeping scripts deterministic.

#### The fixed top-level shortcuts

`abx --help` lists a fixed set of shortcuts under **Sandbox shortcuts**: `create`, `list`, `info`, `kill`, `exec`, `connect`, `upload`, `download`, `run` and `deploy`. Each is documented as "Same as 'abx …'" (`abx create` = `abx sandbox create`, `abx run` = `abx sandbox command run`, `abx deploy` = `abx template deploy`). They are hard-coded: there is no configuration for them, and no top-level `init` or `install`.

Unknown top-level commands get targeted hints: `abx crate` → `Did you mean 'create'?`; with no close match the error points to `abx --help`, `abx template init|install` and `abx run SANDBOX NAME`. See the [CLI command reference](../reference/cli-commands.md) for the full tree.

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

Install `agent-sandbox[mcp]` in the HTTP runtime. Then use the official Alibaba Cloud FC console or SDK to package the artifact and create the function and HTTP trigger. Treat `config.yaml` as a provider-neutral checklist—not an FC API payload—and translate its settings through the official interface. Replace the URL and token placeholders in the printed IDE template with the deployment values.

Clients should call `DELETE /mcp` when a session ends. `GET /mcp` returns 405 until SSE server notifications exist. `abx mcp deploy` refuses to write an artifact without a non-empty Bearer token. `config.yaml` may contain plaintext credentials, so do not commit the artifact or completed IDE configuration to version control.

---

## While a command is running

A step that can sit for a while draws one block on **stderr**:

```text
Building Docker image locally: my-template:latest... 12s
#5 [1/2] FROM ubuntu:22.04
#5 DONE 0.1s
```

The header's elapsed time moves about once a second, including while the tool is silent. The grey rows are the last six lines (`ABX_ACTIVITY_LINES`, from 1 to 10). The same block is used for creating a sandbox, upload, download, fetching a template or the template index, registering a template from an image, installing the coding-agent CLI, `abx kill --all`, and each deploy phase (build, push, wait until READY).

Grey rows include a short redacted tool detail (command, url, query, or path), along with relative paths, install milestones (mirror, checksum, extract), docker or poll lines, and `i/N <id>` while killing. File bytes, thinking, and credentials stay hidden. ACR tokens and `--build-arg` values are not shown.

`--json`, `--quiet`, `--ci`, `TERM=dumb`, and a non-TTY print no such header. Deploy still prints one progress line per phase in those modes. `--verbose` prints the full deploy log instead of the block; other commands keep the header on a terminal. Results stay on stdout.

## Global Options

The `abx` command supports the following global options, which can be used before any subcommand:

| Option | Description |
|--------|-------------|
| `--json` / `-j` | Output in JSON format for easy script parsing |
| `--quiet` / `-q` | Minimize output |
| `--no-color` | Disable colored output |
| `--ci` | CI/CD mode (equivalent to `--quiet --no-color --json`) |

For a detailed list of global options (including `--verbose`, `--log-level`, `--timeout`, etc.), see [CLI Reference — Global Options](../reference/cli-reference.md#global-options). Note that `--region`/`-r` is a command-level option (accepted by `abx list`, `abx kill`, the template control-plane commands, and `abx mcp deploy`), not a global one; set the persistent default via `abx config set region`.

---

## CI/CD Mode

Use the `--ci` flag in automation environments:

```bash
abx --ci create --template base
# Equivalent to --quiet --no-color --json
```

Combined with `--json` for machine-readable output:

```bash
abx --json list | jq '.[] | .sandbox_id'
```

---

## Next Steps

- [Authentication](authentication.md) — Deep dive into authentication methods and configuration priority
- [Using Templates](using-templates.md) — Discover, install, and use templates
- [CLI Reference](../reference/cli-reference.md) — Complete reference for all commands

## Related SDK documentation

- [SDK Usage Guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/sdk-usage.md) — Use Agent Sandbox in Python code
- [Server API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/server-api.md) — the in-sandbox server SDK behind `@registry.command` (Mechanism B)

