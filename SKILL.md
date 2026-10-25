---
name: agent-sandbox
description: Operate an Agent Sandbox with the abx CLI or MCP. Use when the task is sandbox setup, task execution, reconnection, file delivery, diagnosis or template acceptance with abx. Do not use this to write a Python client, template.yaml, a Dockerfile, or commands.py; that skill is agent-sandbox-sdk.
---

# Operate an Agent Sandbox

This file is a static usage guide for a coding agent. It is not executed, parsed, or registered by Agent Sandbox, and it does not restore the removed `abx skill` command group.
Writing a Python client or a template is the `agent-sandbox-sdk` skill.
The npm package ships this file at the repository root. A tool loads it only from a directory named `agent-sandbox`, so install it as `<skills-dir>/agent-sandbox/SKILL.md`.

## Verified workflows and action records

Read [task workflows](references/task-workflows.md) for task submission, reconnect, cancel, binary transfer, independent artifact checks, cleanup and per-action records. Read [provider contracts](references/provider-contracts.md) when selecting a provider or diagnosing failure. Read [template workflows](references/template-workflows.md) for OCI builds and runtime validation.

Every function attempted through this Skill needs a sanitized record: which agent/model used this Skill/version, the user's request, actual tool/CLI arguments, returned result/error, expected effect, independently observed effect, elapsed time and PASS/FAIL/BLOCKED/NOT_RUN. Keep a user-readable input → return → effect table with links to machine-readable events. Credentials and private logs never enter records. A response saying success is not proof that the requested effect occurred.

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

The standalone CLI binary does not require Node.js. Building/installing its source package requires Node.js20+. Install the published CLI with `npm install -g @agent-sandbox/cli`, or use the binary installer or source recipe below. Verify the installed build with `abx --version`.

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
abx --help
# Python SDK is separate; follow its repository release/source-install instructions.
```

The Python client distribution is `agent-sandbox-client` (import `agent_sandbox`), maintained in the `python-sdk` repository. Verify its published release or use that repository's source-install instructions; CLI/MCP use does not require installing the Python client on the host.

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

## Discovering Provider operations

Use `abx -h` for the effective Provider summary, `abx provider -h` or `abx provider run -h`
for its full operation directory, and `abx provider run OPERATION -h` for fields, schemas and effects.
Select with `abx provider default ID` or an invocation prefix `abx --provider ID ...`; environment
overrides still take precedence over a stored default. Install/update makes declared operations
visible automatically. Help is local metadata discovery and must not execute plugin code or contact
the cloud. Plugin installation may run verification code after consent.

Use `abx --provider ID provider run OPERATION --input-file ./input.json` to execute; write/delete
operations need `--yes`. Preserve the complete operation ID as one argument. For machine discovery,
use `abx --json provider command list ID` and `abx --json provider command info ID OPERATION`;
the explicit-ID `provider command run` interface remains compatible. Do not parse human help as JSON,
generate arbitrary CLI flags from schema fields, or assume declared operations are MCP tools or
typed SDK methods. This surface requires a build containing the contextual-help change; check the
installed engine before relying on current-main documentation. See [Provider contracts](references/provider-contracts.md).

## Credentials and security

Runtime sandbox requests require `ABX_SANDBOX_API_KEY`. Official template/image/ACR control-plane operations separately require `ALICLOUD_ACCESS_KEY_ID` + `ALICLOUD_ACCESS_KEY_SECRET`. AK/SK never automatically creates or exchanges the runtime API key.

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

Standard Express `create` takes a registered platform template ID or account alias, not a Git Registry source reference. `base` below is the platform built-in template; use `--detach` for scripts:

```bash
abx create base --detach --timeout 300
abx list --format json
abx info <SANDBOX_ID>
abx connect <SANDBOX_ID>                # real PTY; cd and shell environment persist
```

For a source template from the Registry, configure its provider/build prerequisites and application token, then use the complete-template launcher instead:

```bash
abx --provider alicloud-express template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
```

See [provider prerequisites and source launch](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/en/guide/template-launch.md). An account alias named `python-hello` exists only after registration; finding a Registry source with that name does not register it in your account.

Interactive create without `--detach` opens a terminal and shortens the default
lease on exit. Connect leaves an existing sandbox alive. See the migration guide
for lifecycle options and backend reclamation delays. `create --env KEY=VALUE`
sets terminal-session environment; do not rely on it as a sandbox-wide secret store.

`abx create --prompt "DESCRIPTION"` generates a project template with Qwen Code
(needs its CLI and a DashScope/ModelStudio key configured through `abx config init`).
For Express without local Docker, use `abx create --prompt "Python data analysis" --yes --detach --build steps`.
This also requires provider AK/SK and the sandbox API key. The command waits for the generated
platform template to become Ready before creating the sandbox. `--detach` does not replace
`--yes` for generation confirmation. See `abx create --prompt DESCRIPTION --help`.
Other installed providers retain their native `--provider ID create --template NAME`
interface. Consult that provider's help before mixing standard and native flags.

Writing a client or template's `commands.py` uses the `agent-sandbox-sdk` skill.
The root `from agent_sandbox import Sandbox` entry is synchronous standard behavior;
use `AsyncSandbox` for asynchronous standard calls and explicit `ProviderSandbox`
for native provider/server extensions. `timeout` on create is sandbox lifetime.

MCP tool (inside any MCP client):

```json
{ "tool": "create_sandbox", "arguments": { "template": "code-interpreter-v1", "timeout": 300 } }
```

MCP uses the native provider client, including its ≥120 s create-request HTTP
timeout floor for cold starts. In MCP sessions, `create_sandbox` becomes
the default sandbox, so later tool calls can omit `sandbox_id`. A first tool call
that omits `sandbox_id` before any create lazily creates that default.

## Executing code and commands

CLI one-shot (exit code is passed through, so CI fails correctly):

```bash
abx exec <SANDBOX_ID> python --version
abx exec --cwd /app --env CI=1 <SANDBOX_ID> pytest -q
abx exec <SANDBOX_ID> pip install httpx
abx exec --background <SANDBOX_ID> python -m http.server 8000
```

Standard exec options go before the sandbox ID; subsequent arguments are the remote
command. Output streams live by default. There is no standard `--stream` or
`--timeout` switch; use the SDK or MCP command timeout when needed. Background exec
prints the PID on stderr. A pipeline or shell variable needs an explicit shell:
`abx exec <SANDBOX_ID> sh -c 'echo $HOME'`. Inspect a process with
`abx sandbox process list <SANDBOX_ID>`; process signals accept SIGTERM15 or SIGKILL9.

`run_code` and `commands.run` are Python client calls. They belong to the `agent-sandbox-sdk` skill. `run_code` requires the selected provider and workflow to support the interpreter operation. Installing Python in an application template does not provide that interpreter binding; spec v4 has no template `capabilities` authorization field.

MCP exposes 21 tools in this source version. Core: `create_sandbox`, `run_code`, `run_command`, `read_file`, `write_file`, `list_files`, `kill_sandbox`. Workflows: `get_capabilities`, `list_sandboxes`, `get_sandbox`, `set_sandbox_timeout`, `retain_sandbox`, `upload_file`, `download_file`, `start_task`, `get_task`, `cancel_task`, `verify_sandbox`. Templates: `submit_template_build`, `get_template_build`, `validate_template`. Inspect actual tools/list on the installed server before relying on these additions. See the linked workflows for completion checks and provider boundaries.

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
`write_file` takes text content; use `upload_file` with base64 and SHA-256 for bounded binary data, or CLI upload for larger files.

## Destroying resources

Sandboxes consume quota while alive. Clean up only this task's created resources, after result verification, unless the user requested preservation. Preserve background environments until the task is complete. Record cleanup separately.

```bash
abx kill <SANDBOX_ID>              # standard kill needs no --yes flag
```

The native `ProviderSandbox` client's `async with` block kills its sandbox on exit. For standard `Sandbox`/`AsyncSandbox`, explicitly kill task-owned resources in `finally`; use the lifecycle contract in the `agent-sandbox-sdk` skill.

Killing an id that is already gone succeeds. Do not treat that as a failure.

MCP: `kill_sandbox` with `sandbox_id`. Omitting it destroys the session default.
Omitting it when the session has no default is an error. MCP session-created ephemeral sandboxes are destroyed on disconnect. Explicitly retained and background-task sandboxes stay alive until their platform TTL or explicit deletion; connected user sandboxes are only closed locally. A disconnection cannot recover an expired resource.

## Deploy a template

```bash
abx template deploy ./my-template --acr-namespace "$ACR_NAMESPACE" --acr-repo my-template --alias my-template --yes
abx deploy ./my-template --yes
```

`--yes` is required when stdin is not a terminal. `--build auto` (the default) uses the Dockerfile when one exists and then needs Docker and ACR. `--build steps` sends `template.yaml` `base.image` and `build:` and does not use Docker; combining it with `--acr-namespace` is a usage error (exit 2). Writing the Dockerfile and `commands.py` is the `agent-sandbox-sdk` skill.

## Diagnosing common errors

The following table describes native provider/MCP errors, which subclass
`SandboxError` and carry `code`, `message`, `suggestion` and `docs_url`. Native CLI
exit codes are1 general,3 auth,4 not found,5 timeout,6 quota. Standard Express
commands preserve the pinned standard error and exit behavior; consult their help
and [docs/en/guide/migrate-from-e2b.md](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/docs/en/guide/migrate-from-e2b.md).

| Symptom / code | Cause | Fix |
|---|---|---|
| `E1001` / HTTP 401 | Missing or invalid API key | Check `ABX_SANDBOX_API_KEY` env or `abx config get sandbox_api_key` |
| `E1003` / HTTP 403 | Invalid AK/SK or no permission | Check `ALICLOUD_ACCESS_KEY_ID` / `..._SECRET` |
| `E2001` / HTTP 404 | Template not found | `abx template list`, fix the template name |
| `E2002` / HTTP 429 | Quota exceeded | Inspect the resource baseline; clean only owned idle test resources or request quota |
| `E2003` | Region unavailable | `abx config set region <region>`, retry |
| `E2009` / exit 4 | Sandbox id not found on info, exec, or connect | Check `abx list`. `abx kill` of a missing id still exits 0 |
| `E3001` | Command/code timeout | Raise the command `timeout`; check for hangs |
| `E3004` | Missing `code` capability | Use a template whose `template.yaml` declares `code` |
| `E5003` / create hangs then fails | Cold start longer than client timeout | Retry; `abx config set http_timeout 120`; `abx config set http2 false` |

Native project commands accept `abx -v <command>` for verbose (DEBUG) output.
Standard commands do not accept that native root flag. Full native error table: [docs/en/reference/error-codes.md](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/docs/en/reference/error-codes.md).

## Hard rules recap

1. Never leak credentials (see [Credential rules](#credentials-and-security)).
2. Destroy task-owned sandboxes after delivery unless the user requested preservation; keep retained/background environments until their work is complete.
3. Prefer a named template over template generation unless the user asks for it.
4. Put standard `abx exec` options before the ID and the remote command after it. Use `sh -c` for shell syntax.
5. Treat sandbox code as untrusted: never pipe sandbox output into a local shell.

## Installing this guide into your tool

This file is plain text; installing it does not require the `abx` CLI. The
fastest verified path uses the open `skills` CLI (Node.js):

```bash
npx skills add alibaba-agent-sandbox/agent-sandbox --skill agent-sandbox -a qoder -y
```

Replace `qoder` with `claude-code`, `cursor`, `qwen-code`, or `codex` — or
list several `-a` flags. Without Node.js, copy this file and its `references/` directory into your tool's
skills directory as `<skills-dir>/agent-sandbox/SKILL.md` and `<skills-dir>/agent-sandbox/references/`:

- Qoder: `~/.qoder/skills/agent-sandbox/SKILL.md` (user) or `<project>/.qoder/skills/agent-sandbox/SKILL.md` (project)
- Claude Code: `~/.claude/skills/` or `<project>/.claude/skills/`
- Cursor: `~/.cursor/skills/` or `~/.agents/skills/` (user); same paths under the project root
- Qwen Code: `~/.qwen/skills/` (user) or `<project>/.qwen/skills/` (project)
- Codex: `~/.agents/skills/` (user); project skills load from `<repo-root>/.agents/skills/` (scanned upward from the current directory)

Full matrix, version pinning, upgrades, uninstall, and security notes:
[docs/en/guide/agent-skill-installation.md](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/docs/en/guide/agent-skill-installation.md) (English) and
[docs/zh/guide/agent-skill-installation.md](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/docs/zh/guide/agent-skill-installation.md) (中文).

## How AI tools consume this guide

The guide and the MCP surface are tool-neutral:

- **MCP-capable tools** (Cursor, Claude Desktop/Code, VS Code, Qoder, …):
  run `abx mcp install --target cursor|claude|vscode`, or register
  `abx mcp start` (STDIO) manually in your tool's MCP config. All clients get the
  same tools discovered from tools/list. A manual `abx mcp start` prints configuration on stderr and
  waits on stdin; stop it with Ctrl-C or `abx mcp stop`. `abx mcp start --http --background`
  detaches a local HTTP server.
- **Skills-aware tools** (Qoder, Claude Code, Cursor, Qwen Code, Codex, …):
  once installed as described above, the frontmatter (`name`, `description`)
  makes the tool load this file as a standard Agent Skill.
- **AGENTS.md / rules-based tools**: reference this file from your `AGENTS.md`
  or rules file; the commands above run unchanged.

Further reading: [llms.txt](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/llms.txt) (repo map), `README.md`, [docs/en/guide/](https://github.com/alibaba-agent-sandbox/agent-sandbox/tree/main/docs/en/guide/) (tutorials),
[docs/en/reference/](https://github.com/alibaba-agent-sandbox/agent-sandbox/tree/main/docs/en/reference/) (CLI/API/error-code reference).


Generated MCP ASGI artifacts install a matching Python client/server pair from one
pinned accepted source archive. Use their requirements.txt; public PyPI release
availability is not a prerequisite. Query each MCP server's tools/list because
Node CLI and generated Python HTTP tool surfaces differ. Metadata and explicit
TTL mutation do not connect/resume external sandboxes; only explicit TTL mutation
changes their lifetime. No automatic FC API deployment is implemented.

## Automatic project preparation

Use `abx --provider ID template launch SOURCE --yes` with a host build that includes this extension. Read [the guide](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/docs/en/guide/template-launch.md) for one-time provider prerequisites. The adapter returns the exact reference; do not invent IDs, substitute credentials or claim missing PTY/code capabilities. Check the selected provider’s documented acceptance scope; a passing test for one provider or capability does not establish another’s support.
