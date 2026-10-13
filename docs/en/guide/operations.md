# Operations

The binary registers five command groups: `sandbox`, `template`, `config`, `mcp`, and `provider`. `deploy` is a top-level shortcut, not a group. Each row is the one command for that job. Flags, exit codes, and the full option list are in the linked reference.

Top-level names such as `ebx create` and `ebx install` are shortcuts. They are the same command object as the path in the group (`ebx create` is `ebx sandbox create`). Remap them in `~/.ebx/config.toml` under `[shortcuts]`. See [Shortcut aliases](../reference/cli-reference.md#shortcut-aliases-shortcutsalias).

`ebx <group> -h` prints that group's commands.

## `sandbox` — a running sandbox

| Job | Command | Reference |
|---|---|---|
| Create a sandbox from a template | `ebx create --template base` | [ebx create](../reference/cli-reference.md#ebx-create) |
| Create from a sentence (generates a template, then a sandbox) | `ebx create "a Python environment with pandas"` | [ebx create](../reference/cli-reference.md#ebx-create) |
| List sandboxes | `ebx list` | [ebx list](../reference/cli-reference.md#ebx-list) |
| Show one sandbox | `ebx info <SANDBOX_ID>` | [ebx info](../reference/cli-reference.md#ebx-info) |
| Destroy a sandbox | `ebx kill <SANDBOX_ID>` | [ebx kill](../reference/cli-reference.md#ebx-kill) |
| Run one shell command | `ebx exec <SANDBOX_ID> "echo hello"` | [ebx exec](../reference/cli-reference.md#ebx-exec) |
| Open an interactive shell | `ebx connect <SANDBOX_ID>` | [ebx connect](../reference/cli-reference.md#ebx-connect) |
| Copy a file in | `ebx upload <LOCAL> <SANDBOX_ID>:<REMOTE>` | [ebx upload](../reference/cli-reference.md#ebx-upload) |
| Copy a file out | `ebx download <SANDBOX_ID>:<REMOTE> <LOCAL>` | [ebx download](../reference/cli-reference.md#ebx-download) |
| Run a named template command | `ebx run <SANDBOX_ID> <NAME>` | [ebx run](../reference/cli-reference.md#ebx-run) |
| List files inside the sandbox | `ebx sandbox files list <SANDBOX_ID> --path /app` | [sandbox files](../reference/cli-reference.md#ebx-sandbox-files--file-operations) |
| List processes | `ebx sandbox process list <SANDBOX_ID>` | [sandbox process](../reference/cli-reference.md#ebx-sandbox-process--process-management) |
| Read host metrics and env | `ebx sandbox system info <SANDBOX_ID>` | [sandbox system](../reference/cli-reference.md#ebx-sandbox-system--system-information) |
| See which capability groups are on | `ebx sandbox capabilities <SANDBOX_ID>` | [sandbox capabilities](../reference/cli-reference.md#ebx-sandbox-capabilities--capability-group-status) |
| Stream a shell over HTTP | `ebx sandbox shell-stream <SANDBOX_ID> "echo hello"` | [shell-stream](../reference/cli-reference.md#ebx-sandbox-shell-stream--http-streaming-shell) |

`files` also has `stat`, `mkdir`, `rm`, `mv`, and `search`. `process` also has `start`, `info`, and `signal`. `system` also has `env`, `ports`, `packages`, and `metrics`. The same pages list those subcommands.

## `template` — local project and cloud template

| Job | Command | Reference |
|---|---|---|
| Scaffold a new template directory | `ebx template init -t python ./my-template` | [template init](../reference/cli-reference.md#ebx-template-init) |
| Write template files from a sentence, and stop | `ebx template init "a Python data analysis environment"` | [template init](../reference/cli-reference.md#ebx-template-init) |
| Add template files to a project that already has source | `ebx template init --adopt .` | [template init](../reference/cli-reference.md#ebx-template-init) |
| Build, push, and register | `ebx template deploy ./my-template` | [template deploy](../reference/cli-reference.md#ebx-template-deploy) |
| Build the image only | `ebx template build ./my-template` | [template build](../reference/cli-reference.md#ebx-template-build) |
| Push an image | `ebx template push <IMAGE>` | [template push](../reference/cli-reference.md#ebx-template-push) |
| Register an image that is already in the registry | `ebx template create <IMAGE> --name <NAME>` | [template create](../reference/cli-reference.md#ebx-template-create) |
| Search the catalog | `ebx template search pandas` | [template search](../reference/cli-reference.md#ebx-template-search) |
| Install a catalog template | `ebx template install python-hello` | [template install](../reference/cli-reference.md#ebx-template-install) |
| List registered templates | `ebx template list` | [template list](../reference/cli-reference.md#ebx-template-list) |
| Show one template | `ebx template info <NAME>` | [template info](../reference/cli-reference.md#ebx-template-info) |
| Delete a template | `ebx template delete <NAME>` | [template delete](../reference/cli-reference.md#ebx-template-delete) |

`ebx init` is `ebx template init`. `ebx install` is `ebx template install`.

## `deploy` — shortcut for build, push, and register

| Job | Command | Reference |
|---|---|---|
| Deploy the current directory | `ebx deploy` | [ebx deploy](../reference/cli-reference.md#deploy-command--ebx-deploy) |
| Deploy a directory you name | `ebx deploy ./my-template` | [ebx deploy](../reference/cli-reference.md#deploy-command--ebx-deploy) |

This is the same pipeline as `ebx template deploy`. It is registered as a shortcut (`deploy`), not as a sixth group.

## `config` — keys on this machine

| Job | Command | Reference |
|---|---|---|
| Guided first-time setup | `ebx config init` | [config init](../reference/cli-reference.md#ebx-config-init) |
| Store one key | `ebx config set llm_model qwen3-coder-plus` | [config set](../reference/cli-reference.md#ebx-config-set) |
| Read one key | `ebx config get region` | [config get](../reference/cli-reference.md#ebx-config-get) |
| Show every key and its source | `ebx config list` | [config list](../reference/cli-reference.md#ebx-config-list) |
| Remove one stored value | `ebx config delete acr_namespace` | [config delete](../reference/cli-reference.md#ebx-config-delete) |
| Show the current configuration names | `ebx config list` | [Providers — credentials and configuration keys](providers.md#credentials-and-configuration-keys) |

There is no `ebx config reset`. Clearing one key is `ebx config delete <KEY>` or `ebx config set <KEY> ""`.

## `mcp` — IDE agent tools

| Job | Command | Reference |
|---|---|---|
| Write the IDE config snippet | `ebx mcp install` | [mcp install](../reference/cli-reference.md#ebx-mcp-install) |
| Run the stdio server | `ebx mcp start` | [mcp start](../reference/cli-reference.md#ebx-mcp-start) |
| Stop a server this CLI started | `ebx mcp stop` | [mcp stop](../reference/cli-reference.md#ebx-mcp-stop) |
| Show whether it is running | `ebx mcp status` | [mcp status](../reference/cli-reference.md#ebx-mcp-status) |
| Deploy the HTTP MCP app | `ebx mcp deploy` | [mcp deploy](../reference/cli-reference.md#ebx-mcp-deploy) |

## `provider` — sandbox backends

The group is hidden from `ebx --help` until a plugin is installed or a non-built-in default is set. The commands still run. They are documented in [Providers](providers.md); the command reference does not repeat them.

| Job | Command | Reference |
|---|---|---|
| See built-in and installed providers | `ebx provider list` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Install a local directory while developing | `ebx provider install ./my-cloud --link --yes` | [Authoring providers](authoring-providers.md#3-develop-and-verify) |
| Install from git, pinned to a commit | `ebx provider install <git-url> --ref <40-hex>` | [Authoring providers — install from git](authoring-providers.md#4-publish-and-install-from-git) |
| Show the manifest the user will consent to | `ebx provider info <id>` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Make one provider the default | `ebx provider default <id>` | [Choose a provider](providers.md#choose-a-provider) |
| Check manifest, config, and handshake | `ebx provider doctor <id>` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Run the contract suite | `ebx provider test <id>` | [Install, inspect, remove](providers.md#install-inspect-remove) |
| Use that provider for one sandbox command | `ebx --provider <id> create --template base` | [Choose a provider](providers.md#choose-a-provider) |

When to pass `--provider`, `--model`, and `llm_model`, and when to install the standalone binary: [Best practices](best-practices.md).
