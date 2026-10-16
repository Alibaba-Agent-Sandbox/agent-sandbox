# CLI Command Reference (canonical tree)

Every action has **one canonical path**, written `abx GROUP VERB`. On top of that there is a small, **fixed** set of
top-level shortcuts for the commands people type most. The set is hard-coded: it cannot be extended, renamed or
removed through configuration, and there is no per-user alias table.

<!-- fixed-set -->

Top-level commands, exactly these: `abx sandbox`, `abx template`, `abx config`, `abx mcp`, `abx provider`, `abx create`, `abx list`, `abx info`, `abx kill`, `abx exec`, `abx connect`, `abx upload`, `abx download`, `abx run`, `abx deploy`.

`abx --help` lists them in three sections: **Command groups** (`sandbox`, `template`, `config`, `mcp`), **Providers**
(`provider`) and **Sandbox shortcuts** (the ten shortcuts, each documented as "Same as 'abx …'"). A test fails when
that list and this page disagree.

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

There is no top-level `abx init` or `abx install`: use `abx template init` and `abx template install`
(credentials are `abx config init`).

## Canonical tree

```
abx
├── sandbox
│   ├── create [DESCRIPTION]            list            info SANDBOX_ID        kill [SANDBOX_ID]
│   ├── exec SANDBOX_ID COMMAND...      connect SANDBOX_ID
│   ├── upload SANDBOX_ID LOCAL REMOTE  download SANDBOX_ID REMOTE LOCAL
│   ├── capabilities SANDBOX_ID
│   ├── files    list | mkdir | mv | rm | search | stat
│   ├── process  list | info | signal            (inspect / control only; start a process with exec --background)
│   ├── command  list | run                      (named commands registered on the in-sandbox server)
│   └── system   env | info | metrics | packages | ports
├── template     init | search | info | list | build | push | create | delete | deploy | install
├── config       init | get | set | list | delete
├── mcp          deploy | install | start | status | stop
└── provider     list | show | info | install | uninstall | update | default | config | doctor | test | engine | command
```

`abx provider --help` is owned by the provider documentation ([Providers](../guide/providers.md)); only the group
is part of the fixed surface described here.

Usage lines (from `abx … --help`):

| Command | Usage |
|---|---|
| `abx sandbox create` | `create [OPTIONS] [DESCRIPTION]` |
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
| `abx template init` | `init [OPTIONS] [DIRECTORY]` |
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
| `abx provider command list` | `list [OPTIONS] ID` |
| `abx provider command info` | `info [OPTIONS] ID COMMAND` |
| `abx provider command run` | `run [OPTIONS] ID COMMAND` |

## Global options

`-j/--json`, `-q/--quiet`, `-v/--verbose`, `--no-color`, `--log-level [debug|info|warning|error]`, `--ci`,
`--version`, `-h/--help`. They go before the command (`abx --json list`).

There is no global `--timeout` and no `--profile`. A sandbox **lifetime** is `--timeout SECONDS` on `abx create` only;
a command timeout is `--timeout SECONDS` on `abx exec`.

## Provider management: `abx provider command`

`ID` is the provider ID; `COMMAND` is one of its declared management commands. `list` discovers static metadata;
`info` shows the input/output schemas, effect and idempotency. These calls need no cloud connection. Use
`abx --json provider command list ID` for JSON descriptors or `--quiet` for command IDs only.

```bash
abx provider command list alicloud-express
abx provider command info alicloud-express volume.list
abx --json provider command run alicloud-express volume.list --input '{}'
```

`run` accepts:

| Option | Meaning |
|---|---|
| `--input JSON` | JSON input object; defaults to `{}` when neither input option is supplied |
| `--input-file FILE` | Read a regular JSON file; mutually exclusive with `--input` |
| `-o/--opt KEY=VALUE` | Provider configuration override; repeatable |
| `--region REGION` | Cloud region for this invocation |
| `--yes` | Required for commands with `effect: write` or `delete` |
| `-h/--help` | Show usage |

Both input forms are limited to 1 MiB of UTF-8 bytes. Relative file paths resolve from the current directory.
Use `--input-file request.json` for certificate material or other sensitive request fields, and keep that file out
of version control. Store account credentials through `abx config set providers.ID.KEY` or the provider's
environment variables; secret configuration fields are refused in `--opt`. Parsing errors do not print input
contents. Inspect the schema before running a command; unknown commands fail with E8004, invalid input with
E8002, missing write confirmation with E8012, and conflicting explicit provider selections with E8030.

Management calls are never automatically retried. A timeout or connection error can leave the cloud operation's
outcome unknown. Command names stay under the provider namespace; `abx sandbox command` continues to address
application commands registered inside a sandbox. See [Providers](../guide/providers.md) for supported operations.

## Running commands: `abx exec`

```bash
abx exec SANDBOX_ID -- python --version                 # wait, exit with the remote exit code
abx exec SANDBOX_ID --cwd /app --env DEBUG=1 --timeout 300 -- pytest -q
abx exec SANDBOX_ID --stream -- pip install numpy        # stdout/stderr live
abx exec SANDBOX_ID --background -- python -m http.server 8000   # print the pid, return at once
abx exec SANDBOX_ID "ls /app | wc -l"                    # one quoted argument is a command line (pipes work)
```

| Option | Meaning |
|---|---|
| `--cwd PATH` | working directory (empty = container default) |
| `-e/--env KEY=VALUE` | environment variable, repeatable |
| `-t/--timeout SECONDS` | command timeout (default 60) |
| `--stream` | print stdout/stderr while the command runs |
| `--background` | start the command, print its pid, do not wait (cannot be combined with `--stream`) |

The command after `--` is run exactly as given, without a shell; a single quoted argument is read as a command line
and gets a shell only when it contains pipes or redirects. Use `sh -c '...'` for variable expansion.
Inspect or signal a background process with `abx sandbox process list|info|signal`.

`abx connect SANDBOX_ID` opens a line-by-line REPL. Every line is a new process (state such as `cd` or exported
variables does not persist); it is not a PTY.

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
| `--llm` | LLM API key used for template generation (`abx create "DESCRIPTION"`, `abx template init "DESCRIPTION"`) |

Features that need a missing setting print a one-line pointer to `abx config init --build` or
`abx config init --llm`. Without a terminal (or with `--yes`/`--ci`) the command prints the equivalent
`abx config set …` lines instead of prompting.

## Removed spellings

| Removed | Use |
|---|---|
| top-level `abx init`, `abx install` | `abx template init`, `abx template install` |
| `abx sandbox process start` | `abx exec --background` |
| `abx sandbox shell-stream` | `abx exec --stream` |
| `abx sandbox run` | `abx run` / `abx sandbox command run` |
| global `-t/--timeout`, global `-p/--profile` | `abx create --timeout`, `abx exec --timeout`; no replacement for `--profile` |
| `[shortcuts]` in `config.toml`, `abx config set shortcuts.<name>` | none (the shortcuts are fixed) |
| `custom_commands` in `template.yaml` | register named commands on the in-sandbox server |
| `abx deploy --traditional` | none (the pipeline is fixed) |
