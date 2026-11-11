---
name: agent-sandbox
description: Use when operating Agent Sandbox using abx CLI or MCP for sandbox setup, execution, file delivery and cleanup. Use agent-sandbox-sdk for Python clients or template service implementation.
---

# Operate Agent Sandbox

## When to use

Use this Skill when a task needs an isolated Linux environment, cloud sandbox operations or an existing template. For trivial trusted local operations, use the local workspace. This is a static usage guide, not executed, parsed, or registered by Agent Sandbox. It does not restore the removed `abx skill` command group. It is loaded by a coding tool from `<skills-dir>/agent-sandbox/SKILL.md`.

Read [task workflows](references/task-workflows.md) for task completion and independent artifact checks, [Provider contracts](references/provider-contracts.md) for backend limits, and [template workflows](references/template-workflows.md) for image acceptance. Keep sanitized input → return → observed effect records for attempted functions; record the Skill/version, requested task, elapsed time and pass/fail/blocked/not-run outcome. Never record credentials or private logs. A success response alone does not prove the requested effect.

## Installation and interfaces

See the [English installation guide](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/en/guide/agent-skill-installation.md) or [中文安装指南](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/zh/guide/agent-skill-installation.md) for installing, pinning and removing this Skill.

The commands below require the current source CLI; published 0.5.10 uses the previous layout. Node.js 20+ is required to build:

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
npm link
cd ..
abx --help
```

Use CLI for terminal tasks, `abx mcp install` for an MCP client, and the separate `agent-sandbox-sdk` Skill for Python code. The Node.js SDK is an HTTP client for a running application service. Do not introduce another client facade for a CLI task.

The root lifecycle commands are `deploy`, `list`, `status`, `logs`, `delete`, and `recover`. The groups are `template`, `sandbox`, `config`, `provider`, and `mcp`. Inspect installed `--help` rather than inferring support from a catalog listing.

## Configure

```bash
abx config init
abx config set provider alicloud-express
abx config set region cn-hangzhou
```

Express runtime uses a Sandbox API key. Cloud AK/SK, model credentials and application authentication have separate purposes. Existing credentials may come from process variables, the project dotenv or local user configuration; inspect the project's documented sources before claiming they are missing. Use masked configuration commands. Never print, echo, log, or return credentials. Never print environment dumps or copy secrets into code, chat, records or command examples.

Interactive configuration is saved locally for reuse. Command options and environment variables are temporary overrides. Normal source deployment generates and saves its default `ABX_SERVER_TOKEN`; it is an application token, not a cloud API key. External HTTP clients need that token separately from any platform access headers.

Creating or renewing a management API key needs explicit consent. `--ci` controls output and grants no such consent. If explicitly authorized, prepare through `abx --provider alicloud-express provider run api-key.prepare --yes`. SDK/MCP credential resolution is read-only. See [permissions](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/en/guide/permissions.md).

## Creating a sandbox

```bash
abx deploy --template-id base --name demo --sandbox-timeout 300 --yes
abx status demo
abx sandbox exec demo -- python3 --version
abx sandbox exec --cwd /tmp --timeout 60 demo -- sh -c 'printf hello'
abx sandbox connect demo
abx sandbox upload demo ./input.txt /home/user/input.txt
abx sandbox download demo /home/user/input.txt ./downloaded.txt
abx delete demo --yes
```

`deploy --template-id` accepts a native template ID or alias. Source templates use `abx deploy python-hello --name hello --yes` or `abx deploy ./project --name hello --yes`. `--plan` previews without building or modifying cloud resources. Query actual resources when CPU, memory or region matter; requested values are not observed results.

## Executing code and commands

CLI options for `sandbox exec` go before the name/ID; remote command arguments follow it. Execution preserves the remote exit code. Use `--stream` for live output and `--json` for structured output. Express forwards piped stdin/EOF when the backend supports it. Background execution returns a process ID after input reaches EOF. Shell operators require an explicit shell. A timeout or interrupted local wait does not prove remote work stopped.

File operations use `sandbox upload/download` and `sandbox files`. Check downloaded content independently before delivering it.

`sandbox connect` opens a real PTY. Exiting it leaves the sandbox running. Use `sandbox process list/info/signal` to inspect or control a process. Inspect `sandbox files`, `sandbox system`, and `sandbox capabilities` help for supported operations. Provider-dependent pause, snapshot, network or interpreter support must be checked rather than inferred from command presence.

## Templates and business APIs

```bash
abx template list python
abx template info python-hello
abx template init ./my-template --from python-hello
abx deploy ./my-template --name hello --plan
abx deploy ./my-template --name hello --yes
abx sandbox command list hello
abx sandbox command run hello greet --json-args '{"name":"World"}'
```

Named commands require a deployed application server and registered business function. Running a local registration decorator does not deploy the function. HTTP client examples must use the template's actual business API and authentication.

Template creation uses `template init`, optionally `--prompt` or `--template mcp`. Explicit author builds use `template build`; `template publish --tag VERSION` publishes clean committed source to an existing GitHub remote and returns a pinned reference. It does not create a Registry listing. Follow [template authoring](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/en/guide/authoring-templates.md) for the supported arguments and prerequisites.

Managed applications use the same root lifecycle commands and one Gateway endpoint. See [managed applications](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/en/guide/managed-applications.md) for private bindings and existing database requirements. Do not introduce another environment layer or assume ordinary Sandbox templates are managed applications.

## Provider-native operations

```bash
abx --provider ID provider run --help
abx --provider ID provider run OPERATION --help
abx --provider ID provider run OPERATION --input-file ./input.json
abx --json provider command list ID
abx --json provider command info ID OPERATION
```

Write/delete operations require `--yes` for the authorized operation. All native execution uses `provider run`; `provider command list/info` is discovery only. Template CRUD operations are backend management, separate from source template authoring. Use `--opt region=cn-shanghai` for a one-command Provider setting. A saved deployment preserves its target; conflicting overrides are rejected.

## Destroying resources and recovery

Use `list --local` without cloud access; `list --all-providers` reports partial failures explicitly. `status` observes without resuming a sandbox. For an interrupted deployment, run `recover NAME`; it observes owned resources and does not repeat creation or publication. Keep records when the result is uncertain.

`delete NAME --yes` cleans the deployment's owned resources. Explicitly supplied builds and external databases remain with their owner. After every consumer is deleted, clean an author build with `template build --clean FILE --yes`. Remove images listed for manual cleanup only after checking their remaining references. Independently verify absence where the task requires resource cleanup; preserve failed cleanup as a failure.

## MCP

`abx mcp start` serves local STDIO; stdout is JSON-RPC and diagnostics go to stderr. `mcp start --http` serves local HTTP. Use actual `tools/list` to discover the installed tools. Do not treat discovery as execution acceptance. A deployable HTTP MCP service is an ordinary project from `template init --template mcp`, followed by `deploy`; see [MCP integration](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/en/guide/mcp-integration.md).

MCP tool requests can create billable resources. Check ownership and the user's task scope before creating or deleting them. Validate actual command output, downloaded artifacts and cleanup, not just tool return status.

## Diagnosing common errors

`E1000` indicates authentication failed; check the selected backend and masked credential source.
`E2009` means the sandbox was not found; an expired or deleted sandbox cannot be reconnected.
`E3001` indicates a command timeout; inspect remote state before retrying work with side effects.
Keep platform, model, CLI and application failures separate, and preserve uncertainty where evidence is missing.

Current local MCP tools cover creation and execution (`create_sandbox`, `run_code`, `run_command`),
files (`read_file`, `write_file`, `list_files`, `upload_file`, `download_file`), lifecycle and inspection
(`kill_sandbox`, `get_capabilities`, `list_sandboxes`, `get_sandbox`, `set_sandbox_timeout`, `retain_sandbox`,
`verify_sandbox`), tasks (`start_task`, `get_task`, `cancel_task`), and templates
(`submit_template_build`, `get_template_build`, `validate_template`). Provider support and actual results
must still be checked. Native Express interpreter support differs from running Python in a shell.
