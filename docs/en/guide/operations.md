# Operations

The binary registers five command groups: `sandbox`, `template`, `config`, `mcp`, and `provider`. `deploy` is a top-level shortcut, not a group. Each row is the one command for that job. Flags, exit codes, and the full option list are in the linked reference.

The top-level names `abx create`, `list`, `info`, `kill`, `exec`, `connect`, `upload`, `download`, `run` and `deploy` are a fixed set of shortcuts, shown under **Sandbox shortcuts** in `abx --help`. Each is the same command as its group path (`abx create` is `abx sandbox create`). They cannot be configured. See [CLI Command Reference](../reference/cli-commands.md).

`abx <group> -h` prints that group's commands.

## `sandbox` — a running sandbox

| Job | Command | Reference |
|---|---|---|
| Create a sandbox from a template | `abx create --template base` | [abx create](../reference/cli-reference.md#abx-create) |
| Create from a sentence (generates a template, then a sandbox) | `abx create "a Python environment with pandas"` | [abx create](../reference/cli-reference.md#abx-create) |
| List sandboxes | `abx list` | [abx list](../reference/cli-reference.md#abx-list) |
| Show one sandbox | `abx info <SANDBOX_ID>` | [abx info](../reference/cli-reference.md#abx-info) |
| Destroy a sandbox | `abx kill <SANDBOX_ID>` | [abx kill](../reference/cli-reference.md#abx-kill) |
| Run one command | `abx exec <SANDBOX_ID> -- echo hello` | [abx exec](../reference/cli-reference.md#abx-exec) |
| Open a line-by-line command REPL (every line is a new process, not a PTY) | `abx connect <SANDBOX_ID>` | [abx connect](../reference/cli-reference.md#abx-connect) |
| Copy a file in | `abx upload <SANDBOX_ID> <LOCAL> <REMOTE>` | [abx upload](../reference/cli-reference.md#abx-upload) |
| Copy a file out | `abx download <SANDBOX_ID> <REMOTE> <LOCAL>` | [abx download](../reference/cli-reference.md#abx-download) |
| List / run named commands registered on the in-sandbox server | `abx sandbox command list <SANDBOX_ID>` / `abx run <SANDBOX_ID> <NAME>` | [named commands](../reference/cli-reference.md#named-commands) |
| List files inside the sandbox | `abx sandbox files list <SANDBOX_ID> --path /app` | [sandbox files](../reference/cli-reference.md#abx-sandbox-files--file-operations) |
| List processes | `abx sandbox process list <SANDBOX_ID>` | [sandbox process](../reference/cli-reference.md#abx-sandbox-process--process-inspection) |
| Read host metrics and env | `abx sandbox system info <SANDBOX_ID>` | [sandbox system](../reference/cli-reference.md#abx-sandbox-system--system-information) |
| See which capability groups are on | `abx sandbox capabilities <SANDBOX_ID>` | [sandbox capabilities](../reference/cli-reference.md#abx-sandbox-capabilities--capability-group-status) |
| Stream output live / start in the background | `abx exec <SANDBOX_ID> --stream -- CMD` / `abx exec <SANDBOX_ID> --background -- CMD` | [abx exec](../reference/cli-reference.md#abx-exec) |

`files` also has `stat`, `mkdir`, `rm`, `mv`, and `search`. `process` also has `info` and `signal`. `system` also has `env`, `ports`, `packages`, and `metrics`. The same pages list those subcommands.

## `template` — local project and cloud template

| Job | Command | Reference |
|---|---|---|
| Scaffold a new template directory | `abx template init -t python ./my-template` | [template init](../reference/cli-reference.md#abx-template-init) |
| Write template files from a sentence, and stop | `abx template init "a Python data analysis environment"` | [template init](../reference/cli-reference.md#abx-template-init) |
| Add template files to a project that already has source | `abx template init --adopt .` | [template init](../reference/cli-reference.md#abx-template-init) |
| Build, push, and register | `abx template deploy ./my-template` | [template deploy](../reference/cli-reference.md#abx-template-deploy) |
| Build the image only | `abx template build ./my-template` | [template build](../reference/cli-reference.md#abx-template-build) |
| Push an image | `abx template push <IMAGE>` | [template push](../reference/cli-reference.md#abx-template-push) |
| Register an image that is already in the registry | `abx template create <IMAGE> --name <NAME>` | [template create](../reference/cli-reference.md#abx-template-create) |
| Search the catalog | `abx template search pandas` | [template search](../reference/cli-reference.md#abx-template-search) |
| Install a catalog template | `abx template install python-hello` | [template install](../reference/cli-reference.md#abx-template-install) |
| List registered templates | `abx template list` | [template list](../reference/cli-reference.md#abx-template-list) |
| Show one template | `abx template info <NAME>` | [template info](../reference/cli-reference.md#abx-template-info) |
| Delete a template | `abx template delete <NAME>` | [template delete](../reference/cli-reference.md#abx-template-delete) |

There is no top-level `abx init` or `abx install`; use `abx template init` and `abx template install`.

## `deploy` — shortcut for build, push, and register

| Job | Command | Reference |
|---|---|---|
| Deploy the current directory | `abx deploy` | [abx deploy](../reference/cli-reference.md#deploy-command--abx-deploy) |
| Deploy a directory you name | `abx deploy ./my-template` | [abx deploy](../reference/cli-reference.md#deploy-command--abx-deploy) |

This is the same pipeline as `abx template deploy`. It is registered as a shortcut (`deploy`), not as a sixth group.

## `config` — keys on this machine

| Job | Command | Reference |
|---|---|---|
| Guided first-time setup | `abx config init` | [config init](../reference/cli-reference.md#abx-config-init) |
| Store one key | `abx config set llm_model qwen3-coder-plus` | [config set](../reference/cli-reference.md#abx-config-set) |
| Read one key | `abx config get region` | [config get](../reference/cli-reference.md#abx-config-get) |
| Show every key and its source | `abx config list` | [config list](../reference/cli-reference.md#abx-config-list) |
| Remove one stored value | `abx config delete acr_namespace` | [config delete](../reference/cli-reference.md#abx-config-delete) |
| Show the current configuration names | `abx config list` | [Providers — credentials and configuration keys](providers.md#credentials-and-configuration-keys) |

There is no `abx config reset`. Clearing one key is `abx config delete <KEY>` or `abx config set <KEY> ""`.

## `mcp` — IDE agent tools

| Job | Command | Reference |
|---|---|---|
| Write the IDE config snippet | `abx mcp install` | [mcp install](../reference/cli-reference.md#abx-mcp-install) |
| Run the stdio server | `abx mcp start` | [mcp start](../reference/cli-reference.md#abx-mcp-start) |
| Stop a server this CLI started | `abx mcp stop` | [mcp stop](../reference/cli-reference.md#abx-mcp-stop) |
| Show whether it is running | `abx mcp status` | [mcp status](../reference/cli-reference.md#abx-mcp-status) |
| Deploy the HTTP MCP app | `abx mcp deploy` | [mcp deploy](../reference/cli-reference.md#abx-mcp-deploy) |

## `provider` — sandbox backends

The group is hidden from `abx --help` until a plugin is installed or a non-built-in default is set. The commands still run. They are documented in [Providers](providers.md); the command reference does not repeat them.

| Job | Command | Reference |
|---|---|---|
| See built-in and installed providers | `abx provider list` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Install a local directory while developing | `abx provider install ./my-cloud --link --yes` | [Authoring providers](authoring-providers.md#3-develop-and-verify) |
| Install from git, pinned to a commit | `abx provider install <git-url> --ref <40-hex>` | [Authoring providers — install from git](authoring-providers.md#4-publish-and-install-from-git) |
| Show the manifest the user will consent to | `abx provider info <id>` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Make one provider the default | `abx provider default <id>` | [Choose a provider](providers.md#choose-a-provider) |
| Check manifest, config, and handshake | `abx provider doctor <id>` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Run the contract suite | `abx provider test <id>` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Use that provider for one sandbox command | `abx --provider <id> create --template base` | [Choose a provider](providers.md#choose-a-provider) |

When to pass `--provider`, `--model`, and `llm_model`, and when to install the standalone binary: [Best practices](best-practices.md).
