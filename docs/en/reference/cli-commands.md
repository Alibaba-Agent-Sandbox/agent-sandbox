> For standard Express commands use the [E2B migration contract](../guide/migrate-from-e2b.md): create takes a template, --prompt requests generation, template create uses E2B build semantics, and from-image creates an Alibaba image template.

# CLI Command Reference (canonical tree)

Every action has **one canonical path**, written `abx GROUP VERB`. On top of that there is a small, **fixed** set of
top-level shortcuts for the commands people type most. The set is hard-coded: it cannot be extended, renamed or
removed through configuration, and there is no per-user alias table.

<!-- fixed-set -->

Top-level commands, exactly these: `abx sandbox`, `abx template`, `abx config`, `abx mcp`, `abx provider`, `abx create`, `abx list`, `abx info`, `abx kill`, `abx exec`, `abx connect`, `abx upload`, `abx download`, `abx run`, `abx deploy`.

`abx --help` lists them in three sections: **Command groups** (`sandbox`, `template`, `config`, `mcp`), **Providers**
(`provider`) and **Sandbox shortcuts** (the ten shortcuts, each showing its purpose followed by an
`(alias: abx …)` note). A test fails when that list and this page disagree. A contextual Provider summary follows those sections;
installed operations remain inside the Provider namespace.

## Shortcuts

| Shortcut | Same as |
|---|---|
| `abx create` | `abx sandbox create` |
| `abx list` | `abx sandbox list` |
| `abx info` | `abx sandbox info` |
| `abx kill` | `abx sandbox kill` |
| `abx exec` | `abx sandbox exec` |
| `abx connect` | `abx sandbox connect` |
| `abx upload` | `abx sandbox upload` |
| `abx download` | `abx sandbox download` |
| `abx run` | `abx sandbox command run` |
| `abx deploy` | `abx template deploy` |

There is no top-level `abx init` or `abx install`: use `abx template scaffold` and `abx template install`
(credentials are `abx config init`).

## Canonical tree

```
abx
├── sandbox
│   ├── create [template]            list            info SANDBOX_ID        kill [SANDBOX_ID]
│   ├── exec SANDBOX_ID COMMAND...      connect SANDBOX_ID
│   ├── upload SANDBOX_ID LOCAL REMOTE  download SANDBOX_ID REMOTE LOCAL
│   ├── capabilities SANDBOX_ID
│   ├── files    list | mkdir | mv | rm | search | stat
│   ├── process  list | info | signal            (inspect / control only; start a process with exec --background)
│   ├── command  list | run                      (named commands registered on the in-sandbox server)
│   └── system   env | info | metrics | packages | ports
├── template     init | create | list | delete | scaffold | from-image | search | info | build | push | deploy | install
├── config       init | get | set | list | delete
├── mcp          deploy | install | start | status | stop
└── provider     list | show | info | install | uninstall | update | default | config | doctor | test | engine | command | run
```

`abx provider --help` lists management commands and the selected Provider's operations.
Use `abx provider run OPERATION --help` for JSON fields, schemas and effects, then the
same path to execute. Default/explicit selection, automatic discovery and the compatible
JSON catalog are documented in [Provider operations](../guide/provider-commands.md).
Operation IDs remain opaque and cannot replace fixed host commands. These contextual
entries require a build containing the change; see the guide's release boundary.

Usage lines (from `abx … --help`):

| Command | Usage |
|---|---|
| `abx sandbox create` | `create [options] [template]` |
| `abx sandbox list` | `list [OPTIONS]` |
| `abx sandbox info` | `info [OPTIONS] SANDBOX_ID` |
| `abx sandbox kill` | `kill [OPTIONS] [SANDBOX_ID]` |
| `abx sandbox exec` | `exec [OPTIONS] SANDBOX_ID COMMAND...` |
| `abx sandbox connect` | `connect [OPTIONS] SANDBOX_ID` |
| `abx sandbox upload` | `upload [OPTIONS] SANDBOX_ID LOCAL_PATH REMOTE_PATH` |
| `abx sandbox download` | `download [OPTIONS] SANDBOX_ID REMOTE_PATH LOCAL_PATH` |
| `abx sandbox capabilities` | `capabilities [OPTIONS] SANDBOX_ID` |
| `abx sandbox files list\|mkdir\|mv\|rm\|search\|stat` | `files <verb> [OPTIONS] SANDBOX_ID` (path options `-p/--path`, `-s/--source`, `-d/--dest`) |
| `abx sandbox process list` | `process list [OPTIONS] SANDBOX_ID` |
| `abx sandbox process info\|signal` | `process <verb> [OPTIONS] SANDBOX_ID PID` |
| `abx sandbox command list` | `command list [OPTIONS] SANDBOX_ID` |
| `abx sandbox command run` | `command run [OPTIONS] SANDBOX_ID COMMAND_NAME` |
| `abx sandbox system env\|info\|metrics\|packages\|ports` | `system <verb> [OPTIONS] SANDBOX_ID` |
| `abx template scaffold` | `init [OPTIONS] [DIRECTORY]` |
| `abx template search` | `search [OPTIONS] QUERY` |
| `abx template info` / `delete` | `<verb> [OPTIONS] TEMPLATE_ID` |
| `abx template list` | `list [OPTIONS]` |
| `abx template build` / `deploy` | `<verb> [OPTIONS] TEMPLATE_DIR` (the top-level `abx deploy` takes an optional `[PATH]`, default `.`) |
| `abx template push` / `create` | `<verb> [OPTIONS] IMAGE` |
| `abx template install` | `install [OPTIONS] TEMPLATE_REF` |
| `abx config init\|list` | `<verb> [OPTIONS]` |
| `abx config get\|delete` | `<verb> [OPTIONS] KEY` |
| `abx config set` | `set [OPTIONS] KEY [VALUE]` |
| `abx mcp deploy\|install\|start\|status\|stop` | `<verb> [OPTIONS]` |

## Global options

`-j/--json`, `-q/--quiet`, `-v/--verbose`, `--no-color`, `--log-level [debug|info|warning|error]`, `--ci`,
`--version`, `-h/--help`. They go before the command (`abx --json list`).

There is no global `--timeout` and no `--profile`. A sandbox **lifetime** is `--timeout SECONDS` on `abx create` only;
standard exec has no local command-timeout flag.

## Standard execution and terminals

```bash
abx exec --cwd /app --env MODE=test SANDBOX_ID pytest -q
abx exec --background SANDBOX_ID python -m http.server 8000
abx connect SANDBOX_ID
```

All local exec options precede the sandbox ID. Output streams by default, remote exit status is preserved, and a background PID is written to stderr. There is no standard local --stream or --timeout flag. Connect is a real PTY and preserves cwd/environment between commands; exiting connect leaves the sandbox alive. Interactive create uses the reference lifecycle policy; use --detach when subsequent commands need its ID. See the [complete standard reference](cli-reference.md).

## Named commands: `abx run` / `abx sandbox command`

There is exactly one mechanism: commands registered on the **in-sandbox server** (`CommandRegistry`,
`GET /commands`, `POST /commands/{name}`). They are not declared in `template.yaml`.

```bash
abx sandbox command list SANDBOX_ID                                  # name, arguments, description
abx run SANDBOX_ID build --arg target=staging --arg n=2              # same as: abx sandbox command run
abx run SANDBOX_ID add --json-args '{"x": 1, "y": 2}'                # typed values
```

| Option | Meaning |
|---|---|
| `-a/--arg KEY=VALUE` | command argument (repeatable; the server coerces strings by the declared type) |
| `--json-args JSON` | arguments as a JSON object |
| `--server-port PORT` | port of the in-sandbox server (default 9000) |

A string result is printed as is, any other value as JSON (`--json` wraps it as `{"result": ...}`). A command that
fails on the server exits 1; an unknown name exits 2; a sandbox without a running server reports
"No SandboxServer reachable" and exits non-zero.

## Setup: `abx config init`

`abx config init` asks for the **credentials and the region** only. Two flags add sections:

| Flag | Adds |
|---|---|
| `--build` | ACR namespace and Alibaba Cloud AccessKey (needed by `template build`/`deploy`/`install`) |
| `--llm` | LLM API key used for template generation (`abx create --prompt "DESCRIPTION"`, `abx template scaffold --prompt "DESCRIPTION"`) |

Features that need a missing setting print a one-line pointer to `abx config init --build` or
`abx config init --llm`. Without a terminal (or with `--yes`/`--ci`) the command prints the equivalent
`abx config set …` lines instead of prompting.

## Removed spellings

| Removed | Use |
|---|---|
| top-level `abx init`, `abx install` | `abx template scaffold`, `abx template install` |
| `abx sandbox process start` | `abx exec --background` |
| `abx sandbox shell-stream` | `abx exec` (streams by default) |
| `abx sandbox run` | `abx run` / `abx sandbox command run` |
| global `-t/--timeout`, global `-p/--profile` | `abx create --timeout`; no replacement for `--profile` |
| `[shortcuts]` in `config.toml`, `abx config set shortcuts.<name>` | none (the shortcuts are fixed) |
| `custom_commands` in `template.yaml` | register named commands on the in-sandbox server |
| `abx deploy --traditional` | none (the pipeline is fixed) |

[Standard lifecycle, terminal, parser and exit-code reference](cli-reference.md). Standard local options precede the sandbox ID.

## Native provider image factory

`abx --provider PROVIDER template from-image IMAGE --name NAME -y` is a native extension, independent of the standard template builder. See [provider image deployment](../guide/provider-image-deployment.md). Unopted providers return E8004.
