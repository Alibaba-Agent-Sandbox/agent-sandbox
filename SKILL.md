---
name: agent-sandbox
description: Operate Alibaba Cloud FC Agent Sandbox cloud sandboxes — create isolated Linux environments, run untrusted code and shell commands, transfer files, and clean up — via the abx CLI, the agent_sandbox Python SDK, or MCP tools. Use this when a coding task needs a disposable, isolated cloud environment for building, testing, or running untrusted code instead of the local machine.
---

# Agent Sandbox — Agent Usage Guide

This file is a **static usage guide** for AI coding tools and agents. It follows the
common Agent Skills convention (YAML frontmatter + Markdown instructions) so any
skills-aware tool can load it as-is. It is **not** executed, parsed, or registered by
Agent Sandbox at runtime, and it does **not** restore the removed `abx skill` CLI
command group, Skills registry, or any runtime/template skill configuration
(see ADR 2026-09-23 CLI command reduction and ADR 2026-09-29 skills-design removal).

> This guide is tool-neutral: Qoder, Claude, Cursor, Codex, Qwen Code, and any other
> agent consume the same commands below. See [How AI tools consume this guide](#how-ai-tools-consume-this-guide).

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
| You are writing/running Python and need precise control: streaming output, multiple sandboxes, named commands, terminals, binary transfers, structured error handling | **Python SDK** |
| One-off shell operations, CI steps, or environments without Python orchestration | **CLI** (`abx …`) |

Rule of thumb: **MCP for chat agents, SDK for code, CLI for scripts.** The three
surfaces expose the same sandbox service — pick one, do not mix for the same task
unless crossing contexts (e.g. an SDK script inspecting a sandbox created via MCP).

## Installation

Node.js 20+ is required for the CLI.

```bash
npm install -g @agent-sandbox/cli   # abx CLI + MCP STDIO and Streamable HTTP servers (most agents want this)
npx @agent-sandbox/cli --help       # or run it without installing
pip install agent-sandbox           # Python SDK only (lives in the `python-sdk` repository)
```

If npm reports no matching version (no public npm release as of 2026-09-29 —
check with `npm view @agent-sandbox/cli versions`), install from source:

```bash
git clone https://github.com/alibaba-agent-sandbox/agent-sandbox.git && cd cli
npm ci && npm run build && npm install -g .
```

Verify:

```bash
abx --version
```

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
abx create                              # 'base' template
abx create --template python-hello      # named template, no AI involved
abx create --template base -e API_KEY=x -e DEBUG=1 --timeout 600
abx list                                # find sandbox IDs
abx info <SANDBOX_ID>
```

`abx create "DESCRIPTION"` generates a template with Qwen Code (needs the Qwen Code
CLI plus a DashScope/ModelStudio key via `abx config init`) — prefer `--template`
when you just need a runtime.

Python SDK (async-first; the context manager destroys the sandbox on exit):

```python
from agent_sandbox import Sandbox

async with await Sandbox.create(template="python-hello", timeout=300) as sb:
    print(sb.id, sb.url)
```

MCP tool (inside any MCP client):

```json
{ "tool": "create_sandbox", "arguments": { "template": "code-interpreter-v1", "timeout": 300 } }
```

Note: sandbox creation involves a cold start; the CLI enforces a ≥120 s client HTTP
timeout floor for `create` automatically. In MCP sessions, `create_sandbox` becomes
the default sandbox, so later tool calls can omit `sandbox_id`. A first tool call
that omits `sandbox_id` before any create lazily creates that default.

## Executing code and commands

Code execution (needs a template with the `code` capability; returns
`stdout`, `stderr`, `exit_code`, `output_files`):

```python
result = await sb.run_code("print(sum(range(10)))")          # Python default
result = await sb.run_code("console.log(1)", language="javascript", timeout=30)
```

Shell commands (any template; `timeout` bounds the run):

```python
result = await sb.commands.run("pip install -q httpx", timeout=60)   # cwd option available
result = await sb.commands.run("ls /app | head -5")                    # auto-wrapped in sh -c
```

Commands containing unquoted shell operators (`| ; && || > < ( ) $( )`) are
auto-wrapped in `sh -c`. For variables, backticks, or globs, wrap explicitly:
`sh -c 'echo $HOME'`.

CLI one-shot (exit code is passed through, so CI fails correctly):

```bash
abx exec <SANDBOX_ID> -- python --version
abx exec <SANDBOX_ID> --cwd /app --env CI=1 --timeout 300 -- pytest -q
abx exec <SANDBOX_ID> --stream -- pip install httpx      # live output
abx exec <SANDBOX_ID> --background -- python -m http.server 8000   # prints the pid
```

MCP tools: `run_code` (`code`, `language`, `timeout`, `sandbox_id`) and
`run_command` (`command`, `cwd` default `/app`, `timeout`, `sandbox_id`).
`run_command` is a bare command (argv or command line), not a named command.

Named commands registered on the in-sandbox server (`@registry.command`) are listed with
`abx sandbox command list <SANDBOX_ID>` and run with `abx run <SANDBOX_ID> NAME --arg k=v`
(`--json-args '{"k": 1}'` for typed values).

## File operations

Python SDK (`sb.files`): `read`, `read_bytes`, `write` (str or bytes), `list`,
`exists`, `remove`, `make_dir`, `upload(local, remote)`, `download(remote, local)`.

```python
await sb.files.write("/app/main.py", "print('hi')\n")
text = await sb.files.read("/app/main.py")
entries = await sb.files.list("/app")
await sb.files.download("/app/report.csv", "./report.csv")
```

CLI:

```bash
abx upload <SANDBOX_ID> ./app /app          # file or directory
abx download <SANDBOX_ID> /app/result.csv .
abx sandbox files list <SANDBOX_ID> --path /app
```

MCP tools: `read_file` (`path`, `encoding`, `sandbox_id`), `write_file` (`path`,
`content`, `sandbox_id`), `list_files` (`path` default `/app`, `sandbox_id`).
`write_file` takes text content; for binary data use the SDK or CLI.

## Destroying resources

Sandboxes consume quota while alive. Always clean up when done.

```bash
abx kill <SANDBOX_ID> --yes        # --yes skips confirmation (use in scripts)
abx kill --all --yes               # destroy every running sandbox
```

```python
await sb.kill()                          # or rely on the async context manager
await Sandbox.kill_by_id("<SANDBOX_ID>") # destroy by ID without connecting
```

MCP: `kill_sandbox` with `sandbox_id` (omitting it destroys the session's default
sandbox). MCP session sandboxes are also destroyed when the client disconnects.

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
| `E3001` | Command/code timeout | Raise the `timeout` argument; check for hangs |
| `E3004` | Missing `code` capability | Use a template whose `template.yaml` declares `code` |
| `E5003` / create hangs then fails | Cold start longer than client timeout | Retry; `abx config set http_timeout 120`; `abx config set http2 false` |

Run `abx -v <command>` for verbose (DEBUG) output before concluding a failure is
a bug. Full error table: `docs/en/reference/error-codes.md`.

## Hard rules recap

1. Never leak credentials (see [Credential rules](#credentials-and-security)).
2. Always destroy sandboxes you create (`kill` / context manager) — quota is shared.
3. Prefer `--template NAME` over template generation unless the user asks for it.
4. Quote shell commands; rely on the auto `sh -c` wrap only for simple operators.
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
  same 7 tools. A manual `abx mcp start` prints configuration on stderr and
  waits on stdin; stop it with Ctrl-C or `abx mcp stop`. `abx mcp start --http --background`
  detaches a local HTTP server.
- **Skills-aware tools** (Qoder, Claude Code, Cursor, Qwen Code, Codex, …):
  once installed as described above, the frontmatter (`name`, `description`)
  makes the tool load this file as a standard Agent Skill.
- **AGENTS.md / rules-based tools**: reference this file from your `AGENTS.md`
  or rules file; the commands above run unchanged.

Further reading: `llms.txt` (repo map), `README.md`, `docs/en/guide/` (tutorials),
`docs/en/reference/` (CLI/API/error-code reference).
