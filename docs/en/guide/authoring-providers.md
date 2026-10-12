# Authoring Providers

A provider plugin is a directory with an `ebx-provider.toml` manifest and, for the `exec` kind, a program that speaks **EPP/1** (JSON-RPC 2.0, one JSON object per line, over stdin/stdout). The same plugin works for the Node CLI and the Python SDK, in any language. This page is the short, CLI-oriented path; the protocol and trust model are specified in the [Python SDK design](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/design/providers-and-credentials.md) and the user side is in [Providers](providers.md).

Working examples (copy one):

| Directory in `python-sdk/examples/providers/` | Kind | Shows |
|---|---|---|
| `e2b-compatible/` | `rest` | A manifest only: any E2B-protocol endpoint, consented `inherit` of the generic `sandbox_*` keys |
| `local-process/` | `exec`, Python stdlib | lifecycle, exec (buffered and streamed), files, a secret and a bool option |
| `opensandbox/` | `exec`, dependency-free Node ESM | a complete real backend: lifecycle, pause/resume, streaming exec, files, port URLs, unit/mock/live/contract tests |

## 1. The manifest

```toml
manifest_version = 1

[provider]
id      = "my-cloud"                   # ^[a-z][a-z0-9]*(-[a-z0-9]+)*$, not a reserved id
name    = "My Cloud"
version = "0.1.0"

[compat]
protocol = "epp/1"
requires = { sdk = ">=0.3", cli = ">=0.3" }   # the CLI refuses to start an incompatible plugin (E8013)

[runtime]
kind    = "exec"
command = ["node", "./provider.mjs"]    # run with the plugin directory as the working directory
startup_timeout_ms = 10000
call_timeout_ms    = 60000

[features]
supported = ["sandbox.lifecycle", "exec.run", "exec.stream", "files.rw"]

[security]                               # advisory: shown on the consent screen, not enforced
network          = ["api.my-cloud.example"]
filesystem       = ["data_dir"]
spawns_processes = false

[core]
inherit = []                             # generic keys (sandbox_api_key, ...) you want to receive; the user must consent

[config.fields.api_key]
type = "string"
secret = true                            # stored in ~/.ebx/.env as EBX_MY_CLOUD_API_KEY, masked everywhere
credential = true
required = true
description = "API key"

[config.fields.region]
type = "enum"
choices = ["eu-1", "us-1"]
default = "eu-1"
```

Rules worth knowing:

- **Configuration only reaches the plugin through `initialize`.** The plugin process starts with a minimal environment. It receives the options it declares and the generic keys listed in `[core] inherit` that the user consented to; nothing else.
- Declare every feature you implement. A command that needs another feature fails with `E8004` before any request is made, so a missing method is never an `AttributeError` or a 404.
- Option names are `[a-z][a-z0-9_]*`. Canonical environment names are derived: `EBX_<PROVIDER_ID>_<KEY>` (dashes become underscores). Add `env = ["VENDOR_NAME"]` to accept the backend's native variable too.
- `ebx provider info my-cloud` shows what the user will see; `ebx provider install ./my-cloud --link --yes` installs in place while developing.

## 2. The EPP/1 methods

The CLI calls these over stdin/stdout (the authoritative list is `docs/design/fixtures/epp-methods.json`):

| Group | Methods |
|---|---|
| handshake | `initialize` (config in, `features` out), `shutdown` |
| `sandbox.*` | `create`, `connect`, `list`, `info`, `kill`, `set_timeout`, `pause`, `resume` |
| `exec.*` | `run` (buffered) and `stream` (notifications) |
| `process.*` | `list`, `kill`, `send_stdin`, `connect` |
| `files.*` | `read`, `write`, `list`, `stat`, `remove`, `mkdir`, `rename`, `exists` |
| `ports.*` | `url` (becomes `sandbox.network.resolve(port)`) |

Errors use JSON-RPC codes plus `data.sdk_code`: `-32002` maps to the SDK error named by `data.sdk_code` (for example `E2001`), or to `E8005` when none is given (exit 4). Sandbox ids returned by the plugin are bare; the CLI qualifies them as `my-cloud:<id>` when printing. `ProcessInfo.pid` may be a number or a string.

A backend that already speaks the E2B envd data plane only needs the control plane (create, connect, list, kill) plus the envd URL in the result: commands, files and terminals then use the native fast transports. A backend without envd implements `exec.*` and `files.*` as well.

## 3. Develop and verify

```bash
ebx provider install ./my-cloud --link --yes       # in place, no integrity check (development only)
ebx provider doctor my-cloud                       # manifest, requires, configuration completeness, handshake
ebx config set providers.my-cloud.api_key          # masked prompt
ebx provider test my-cloud -o region=eu-1          # the contract suite (18 cases; unsupported features are skipped)
ebx --provider my-cloud create --template base
```

`ebx provider test` runs the same contract kit that the reference plugins pass: lifecycle, exec, streaming, files, process control, timeouts, error mapping. Unit-test your plugin without the CLI by driving the process with NDJSON on stdin.

## 4. Publish and install from git

1. Put `ebx-provider.toml` at the repository root, or in one subdirectory. Keep unit tests, fixtures, and anything you do not want hashed out of that directory.
2. Commit the plugin files. A tag or a branch is not a pin.
3. Copy the full 40-hex commit. That is the value users pass as `--ref`.

```bash
# interactive: prints the consent screen, then copies the tree
ebx provider install https://github.com/you/ebx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7

# plugin lives in providers/my-cloud inside a larger repo
ebx provider install https://github.com/you/plugins.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7 \
  --subdir providers/my-cloud

# CI, no TTY: --yes acknowledges the consent screen (exit 2 / E8012 without it)
ebx provider install https://github.com/you/ebx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7 --yes
```

What that command does:

- Git is fetched without checking the tree out. The installer writes the files itself. Nothing from the plugin runs during install.
- A tag or branch in `--ref` is unpinned. A non-interactive install of an unpinned ref needs `--allow-unpinned`.
- `--sha256 <tree digest>` pins the tree and fails the install when the digest differs.
- `--subdir` must be a relative path inside the repo. Use it so large test suites stay out of the install: every file except `data/` is hashed into the tree digest, and that digest is checked again on every start (`E8011` when a file changed).
- URLs with embedded credentials are rejected. `file://`, `git://`, and `http://` need `--allow-insecure-transport` and are for development only.
- After install, `ebx provider doctor <id>` checks the manifest, version requirement, configuration, and handshake. Move a pinned install with `ebx provider update <id> --ref <new 40-hex commit>`.

Document the `[security]` block honestly: it is the user's only summary of what the plugin may touch, and the CLI does not sandbox the plugin process. The user-facing install rules are also in [Providers](providers.md#install-inspect-remove).

## 5. Template profile

Optional `[template]` table. When the table is absent, template generation uses the generic Docker profile (`FROM python:3.12-slim`, `CMD ["python3", "commands.py"]`, `WORKDIR /app`) and says this provider had no profile. It does not use the Alibaba Cloud Express FC image. OpenSandbox stays on that generic profile; its create `entrypoint` is unchanged.

When the table is present, every required field below must be set. A missing or wrong field is `Invalid ebx-provider.toml: [template] ...` and the plugin does not load.

| Field | Required | Rule |
|---|---|---|
| `base_image` | yes | Non-empty string. Dockerfile `FROM`. |
| `entrypoint_replaceable` | yes | Boolean. `false` means the generator does not emit `ENTRYPOINT`. |
| `server_start` | yes | `image_cmd` or `platform_start_cmd`. |
| `cmd` | with `image_cmd` | Array of non-empty strings. Must be empty or omitted when `server_start` is `platform_start_cmd`. |
| `start_cmd` | with `platform_start_cmd` | Non-empty string. Must be empty or omitted when `server_start` is `image_cmd`. |
| `ready_cmd` | no | String, or omit it. |
| `arch` | yes | Non-empty string, for example `linux/amd64`. |
| `workdir` | yes | Non-empty string. Dockerfile `WORKDIR`. |
| `reserved_ports` | no | Array of integers from 1 to 65535. Ports the template must not bind. Omit or `[]` when there are none. |
| `registry` | yes | Non-empty note about how the image is pulled. Credentials stay in provider config, not in this string. |

Image-command profile (generic Docker):

```toml
[template]
base_image = "python:3.12-slim"
entrypoint_replaceable = true
server_start = "image_cmd"
cmd = ["python3", "commands.py"]
arch = "linux/amd64"
workdir = "/app"
reserved_ports = []
registry = "pull by image URI; private-registry auth stays in provider config"
```

Platform start profile (no `CMD` or `ENTRYPOINT` in the Dockerfile; the platform runs `start_cmd` and probes `ready_cmd`):

```toml
[template]
base_image = "registry.example/runtime/base:1"
entrypoint_replaceable = false
server_start = "platform_start_cmd"
start_cmd = "easy-sandbox-server serve --port 9000 --commands /opt/app/commands.py"
ready_cmd = "easy-sandbox-server healthcheck --port 9000"
arch = "linux/amd64"
workdir = "/opt/app"
reserved_ports = [5000]
registry = "pull by image URI; private-registry auth stays in provider config"
```

`commands.py` still imports only `easy_sandbox.server` and calls `serve(port=9000)` under `if __name__ == "__main__"`. The server package does not read this table.

The built-in `alicloud-express` profile is a constant in the CLI, not a plugin manifest: `server_start = "platform_start_cmd"`, workdir `/home/user/app`, reserved ports `49983`, `5000`, and `49999`, and an FC registry image whose region matches the sandbox region. A plugin that wants that image names it in its own `base_image`. A plugin that omits `[template]` never inherits it.
