---
name: agent-sandbox
description: Operate an Agent Sandbox with the abx CLI or MCP. Use when the task is to create a sandbox, run a command in it, copy files, kill it, or deploy a template with abx. Do not use this to write a Python client, template.yaml, a Dockerfile, or commands.py; that skill is agent-sandbox-sdk.
---

# Operate an Agent Sandbox

This file is a static usage guide for a coding agent. It is not executed, parsed, or registered by Agent Sandbox, and it does not restore the removed `abx skill` command group.
Writing a Python client or a template is the `agent-sandbox-sdk` skill.
The npm package ships this file at the repository root. A tool loads it only from a directory named `agent-sandbox`, so install it as `<skills-dir>/agent-sandbox/SKILL.md`.

## When to use

Use Agent Sandbox when a task needs an isolated, disposable Linux environment:

- Running untrusted or unverified code (user-submitted snippets, generated patches, scraped scripts)
- Building and testing projects without polluting the local machine (pip/npm/go installs, compilers)
- Data analysis or batch processing with heavy, throwaway dependencies
- Previewing a web service on a public URL without exposing local ports
- Reproducing a bug in a clean environment

Do **not** use it for trivial local operations (reading a file, `git status`) — that is
slower and costs quota. Local execution is fine when the code is trusted and simple.

## Choosing an interface: MCP vs SDK vs CLI

| Situation | Use |
|---|---|
| You are an agent inside an MCP client (Cursor, Claude Desktop/Code, VS Code, Qoder, …) and want sandbox tools without writing Python | **MCP** (`abx mcp install`) |
| You are writing Python that creates or drives a sandbox | **Python SDK** (the `agent-sandbox-sdk` skill) |
| One-off shell operations, CI steps, or environments without Python orchestration | **CLI** (`abx …`) |

Rule of thumb: **MCP for chat agents, SDK for code, CLI for scripts.** MCP and the CLI both drive `alicloud-express` and any installed `node`, `exec` or `rest` plugin. The catalog providers `opensandbox`, `alicloud-container`, `cubesandbox` and `e2b` are `node` plugins and run from the CLI and from the Python SDK (the SDK uses the local engine). Pick one surface for a task.

## Installation

Node.js 20+ is required for the CLI.

```bash
npm install -g @agent-sandbox/cli   # abx CLI + MCP STDIO and Streamable HTTP servers (most agents want this)
npx @agent-sandbox/cli --help       # or run it without installing
pip install agent-sandbox-client    # Python SDK only (import agent_sandbox; lives in the `python-sdk` repository)
```

`pip install agent-sandbox` installs an unrelated project.

If npm reports no matching version, install from the CLI repository. The clone root is the CLI; do not look for a nested cli directory:

```bash
git clone https://github.com/alibaba-agent-sandbox/agent-sandbox.git
cd agent-sandbox && npm ci && npm run build && npm install -g .
```

Verify:

```bash
abx --version
```

Command groups are `sandbox`, `template`, `config`, `mcp`, and `provider`. Shortcuts, in this order, are `create`, `list`, `info`, `kill`, `exec`, `connect`, `upload`, `download`, `run`, and `deploy`. Nothing in config adds a top-level command.

`abx` loads the built-in provider `alicloud-express`, plus installed `node`, `exec` and `rest` plugins. The catalog providers `opensandbox`, `alicloud-container`, `cubesandbox` and `e2b` are `node` plugins (ES module `provider.mjs`, `create(kit)`). Install one with `abx provider install alibaba-agent-sandbox/awesome-providers//<id>` (a local path or a git URL also works) and run `abx --provider <id> ...`. An id that is neither built in nor installed exits `E8001`. A manifest with `kind = "python"` cannot be installed. In-code Python `Provider` subclasses still work in the Python SDK. That SDK runs the same `node` plugins through the local engine, `abx provider engine serve` (`abx` on `PATH` or `ABX_BIN`). `python -m agent_sandbox.providers install registry:<id> --yes` is the SDK installer and fetches the catalog index. `exec` (EPP/1 over stdio, any language, optional `pty.*`) remains for third-party plugins.

## Credentials and security

Authentication options (first available wins):

1. API key — environment variable `ABX_SANDBOX_API_KEY`
2. Alibaba Cloud AK/SK — `ALICLOUD_ACCESS_KEY_ID` + `ALICLOUD_ACCESS_KEY_SECRET`

Persist them locally instead of exporting in every shell:

```bash
abx config set sandbox_api_key <YOUR_KEY>        # stored in ~/.abx/.env
abx config set region cn-hangzhou        # region (or export ALIBABA_CLOUD_REGION_ID)
abx config get sandbox_api_key                   # shows a masked value
```

**Credential rules — never violate these:**

- **Never print, echo, log, or return an API key or AK/SK** in commands, code, or
  command output. Do not run `env`, `printenv`, or dump `~/.abx/.env` into results.
- **Never paste real keys into chat, code, commit messages, config files, or sandbox
  files.** Use placeholders (`REPLACE_ME`) in anything that gets committed.
- Read credentials only via masked commands (`abx config get sandbox_api_key`) or from the
  environment at runtime.
- The MCP deploy artifact (`config.yaml` from `abx mcp deploy`) contains secrets —
  never commit it.
- If a credential may have leaked (appeared in output, a file, or a transcript),
  state that it must be **rotated immediately**; do not attempt to "un-leak" it.

## Creating a sandbox

CLI (default template is `base`; DESCRIPTION and `--template` are mutually exclusive):

```bash
abx create                              # template 'base'; --timeout is the lifetime in seconds (default 300)
abx create --template python-hello      # named template, no AI involved
abx create --template base -e API_KEY=x -e DEBUG=1 --timeout 600
abx list                                # find sandbox IDs
abx info <SANDBOX_ID>
abx connect <SANDBOX_ID>                # one command per line; cd and env do not persist
```

`abx create "DESCRIPTION"` generates a template with Qwen Code (needs the Qwen Code
CLI plus a DashScope/ModelStudio key via `abx config init`) — prefer `--template`
when you just need a runtime.

Writing that client, or a template's `commands.py`, is the `agent-sandbox-sdk` skill. The import is `from agent_sandbox import Sandbox`. `timeout` on `create` is the sandbox lifetime in seconds.

MCP tool (inside any MCP client):

```json
{ "tool": "create_sandbox", "arguments": { "template": "code-interpreter-v1", "timeout": 300 } }
```

Note: sandbox creation involves a cold start; the CLI enforces a ≥120 s client HTTP
timeout floor for `create` automatically. In MCP sessions, `create_sandbox` becomes
the default sandbox, so later tool calls can omit `sandbox_id`. A first tool call
that omits `sandbox_id` before any create lazily creates that default.

## Executing code and commands

CLI one-shot (exit code is passed through, so CI fails correctly):

```bash
abx exec <SANDBOX_ID> -- python --version
abx exec <SANDBOX_ID> --cwd /app --env CI=1 --timeout 300 -- pytest -q
abx exec <SANDBOX_ID> --stream -- pip install httpx      # live output
abx exec <SANDBOX_ID> --background -- python -m http.server 8000   # prints the pid
```

`--timeout` here bounds the command (default 60). It is not the sandbox lifetime. `--cwd` defaults to the image workdir. Arguments after `--` are the command. A pipeline or a shell variable needs an explicit shell: `abx exec <SANDBOX_ID> -- sh -c 'echo $HOME'`. A background process is `abx sandbox process list <SANDBOX_ID>`. `abx sandbox process signal` accepts only signal 15 (SIGTERM) or 9 (SIGKILL).

`run_code` and `commands.run` are Python client calls. They belong to the `agent-sandbox-sdk` skill. `run_code` needs a template whose capabilities include `code`.

MCP tools are: `create_sandbox`, `list_sandboxes`, `get_sandbox`, `set_sandbox_timeout`, `run_code`, `run_command`, `read_file`, `write_file`, `list_files`, `kill_sandbox`.

`list_sandboxes` lists authorized visibility without adopting instances. `get_sandbox` refreshes only safe metadata without renewing TTL. `set_sandbox_timeout` sets 1–86400 seconds from now. Get/set require an existing default when ID is omitted; external IDs are never added to session cleanup. `create_sandbox` also accepts provider, region, positive CPU and memory (MB) controls.

`run_command` runs the string with `sh -c`. Omitted `cwd` is the image workdir, not `/app`. `timeout` defaults to 60. It is a shell command, not a named command.

Named commands registered in the template with `@command` (see the `agent-sandbox-sdk` skill) are listed with
`abx sandbox command list <SANDBOX_ID>` and run with `abx run <SANDBOX_ID> NAME --arg k=v`
(`--json-args '{"k": 1}'` for typed values).

## File operations

`sb.files` (`read`, `read_bytes`, `write`, `list`, `exists`, `remove`, `make_dir`, `upload`, `download`) is the `agent-sandbox-sdk` skill.

CLI:

```bash
abx upload <SANDBOX_ID> ./app /app          # file or directory
abx download <SANDBOX_ID> /app/result.csv .
abx sandbox files list <SANDBOX_ID> --path /app
```

MCP: `read_file` (`path`, `encoding`, `sandbox_id`), `write_file` (`path`,
`content`, `sandbox_id`), `list_files` (`path` default `/`, `sandbox_id`).
`write_file` takes text content; for binary data use the CLI upload.

## Destroying resources

Sandboxes consume quota while alive. Always clean up when done.

```bash
abx kill <SANDBOX_ID> --yes        # --yes skips confirmation (use in scripts)
abx kill --all --yes               # destroy every running sandbox
```

The Python client's `async with` block kills the sandbox on exit. That client is the `agent-sandbox-sdk` skill.

Killing an id that is already gone succeeds. Do not treat that as a failure.

MCP: `kill_sandbox` with `sandbox_id`. Omitting it destroys the session default.
Omitting it when the session has no default is an error. MCP session sandboxes
are also destroyed when the client disconnects.

## Deploy a template

```bash
abx template deploy ./my-template --acr-namespace "$ACR_NAMESPACE" --acr-repo my-template --alias my-template --yes
abx deploy ./my-template --yes
```

`--yes` is required when stdin is not a terminal. `--build auto` (the default) uses the Dockerfile when one exists and then needs Docker and ACR. `--build steps` sends `template.yaml` `base.image` and `build:` and does not use Docker; combining it with `--acr-namespace` is a usage error (exit 2). Writing the Dockerfile and `commands.py` is the `agent-sandbox-sdk` skill.

## Diagnosing common errors

All SDK errors subclass `SandboxError` and carry `code`, `message`, `suggestion`,
and `docs_url`. CLI exit codes: 1 general, 3 auth, 4 not found, 5 timeout, 6 quota.

| Symptom / code | Cause | Fix |
|---|---|---|
| `E1001` / HTTP 401 | Missing or invalid API key | Check `ABX_SANDBOX_API_KEY` env or `abx config get sandbox_api_key` |
| `E1003` / HTTP 403 | Invalid AK/SK or no permission | Check `ALICLOUD_ACCESS_KEY_ID` / `..._SECRET` |
| `E2001` / HTTP 404 | Template not found | `abx template list`, fix the template name |
| `E2002` / HTTP 429 | Quota exceeded | `abx kill --all --yes`, retry or request quota |
| `E2003` | Region unavailable | `abx config set region <region>`, retry |
| `E2009` / exit 4 | Sandbox id not found on info, exec, or connect | Check `abx list`. `abx kill` of a missing id still exits 0 |
| `E3001` | Command/code timeout | Raise the command `timeout`; check for hangs |
| `E3004` | Missing `code` capability | Use a template whose `template.yaml` declares `code` |
| `E5003` / create hangs then fails | Cold start longer than client timeout | Retry; `abx config set http_timeout 120`; `abx config set http2 false` |

Run `abx -v <command>` for verbose (DEBUG) output before concluding a failure is
a bug. Full error table: `docs/en/reference/error-codes.md`.

## Hard rules recap

1. Never leak credentials (see [Credential rules](#credentials-and-security)).
2. Always destroy sandboxes you create (`kill` / context manager) — quota is shared.
3. Prefer `--template NAME` over template generation unless the user asks for it.
4. Pass `abx exec` arguments after `--`. Use `sh -c` when the command needs a shell.
5. Treat sandbox code as untrusted: never pipe sandbox output into a local shell.

## Installing this guide into your tool

This file is plain text; installing it does not require the `abx` CLI. The
fastest verified path uses the open `skills` CLI (Node.js):

```bash
npx skills add agent-sandbox/agent-sandbox --skill agent-sandbox -a qoder -y
```

Replace `qoder` with `claude-code`, `cursor`, `qwen-code`, or `codex` — or
list several `-a` flags. Without Node.js, copy this file into your tool's
skills directory as `<skills-dir>/agent-sandbox/SKILL.md`:

- Qoder: `~/.qoder/skills/agent-sandbox/SKILL.md` (user) or `<project>/.qoder/skills/agent-sandbox/SKILL.md` (project)
- Claude Code: `~/.claude/skills/` or `<project>/.claude/skills/`
- Cursor: `~/.cursor/skills/` or `~/.agents/skills/` (user); same paths under the project root
- Qwen Code: `~/.qwen/skills/` (user) or `<project>/.qwen/skills/` (project)
- Codex: `~/.agents/skills/` (user); project skills load from `<repo-root>/.agents/skills/` (scanned upward from the current directory)

Full matrix, version pinning, upgrades, uninstall, and security notes:
`docs/en/guide/agent-skill-installation.md` (English) and
`docs/zh/guide/agent-skill-installation.md` (中文).

## How AI tools consume this guide

The guide and the MCP surface are tool-neutral:

- **MCP-capable tools** (Cursor, Claude Desktop/Code, VS Code, Qoder, …):
  run `abx mcp install --target cursor|claude|vscode`, or register
  `abx mcp start` (STDIO) manually in your tool's MCP config. All clients get the
  same 10 tools listed above. A manual `abx mcp start` prints configuration on stderr and
  waits on stdin; stop it with Ctrl-C or `abx mcp stop`. `abx mcp start --http --background`
  detaches a local HTTP server.
- **Skills-aware tools** (Qoder, Claude Code, Cursor, Qwen Code, Codex, …):
  once installed as described above, the frontmatter (`name`, `description`)
  makes the tool load this file as a standard Agent Skill.
- **AGENTS.md / rules-based tools**: reference this file from your `AGENTS.md`
  or rules file; the commands above run unchanged.

Further reading: `llms.txt` (repo map), `README.md`, `docs/en/guide/` (tutorials),
`docs/en/reference/` (CLI/API/error-code reference).
