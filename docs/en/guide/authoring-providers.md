# Authoring Providers

A provider plugin is a directory with an `abx-provider.toml` manifest and, for the `exec` kind, a program that speaks **EPP/1** (JSON-RPC 2.0, one JSON object per line, over stdin/stdout), or, for the `node` kind, an ES module the host loads. The same plugin works for the Node CLI and every SDK (through the [engine](../reference/engine-api.md)); an `exec` plugin can be written in any language. This page is the short, CLI-oriented path; the protocol and trust model are specified in the [Python SDK design](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/providers-and-credentials.md) and the user side is in [Providers](providers.md).

Publish plugins in [alibaba-agent-sandbox/awesome-providers](https://github.com/alibaba-agent-sandbox/awesome-providers), one directory per provider. Do not put them in the SDK or CLI repositories. That catalog also has the contributor guide (`docs/authoring.md`) and the agent skill (`SKILL.md`) for writing a provider.

## How `abx create` reaches a provider

`abx create` does not import your plugin. It calls `Sandbox.create`, and that call picks a provider before any sandbox API runs.

```text
abx --provider my-cloud create --template base
        │
        │  1. main() pulls --provider and --opt out of the argv (any position)
        │     and stores them for this process only.
        ▼
Sandbox.create({ template: "base", ... })
        │
        │  2. Provider id, first match wins:
        │     explicit provider= argument
        │     > --provider
        │     > ABX_PROVIDER
        │     > ./.env
        │     > ~/.abx/.env
        │     > [core] provider in ~/.abx/config.toml
        │     > alicloud-express
        ▼
   alicloud-express?  ── yes ──► built-in Alibaba Cloud client. Your plugin is not started.
        │
        no
        ▼
   3. Load ~/.abx/providers/my-cloud (manifest + receipt). The tree digest is
      checked. A mismatch is E8011 and the process is not started.
        ▼
   4. Start [runtime] command with a scrubbed environment and the plugin
      directory as cwd. Speak EPP/1 on stdin/stdout.
        ▼
   5. initialize { protocol, host, provider_id, config, core, locale, data_dir }
      The plugin answers with the features it implements.
        ▼
   6. sandbox.create { template, timeout, metadata, envs, cpu, memory, disk,
      gpu, request_timeout, secure?, options? }
        ▼
   7. SandboxRecord { sandbox_id, template, status, ... }. The CLI prints the
      id as my-cloud:<sandbox_id> unless both the default and this command
      are still alicloud-express.
```

Later commands (`exec`, `upload`, `kill my-cloud:<id>`) use that same id. The host checks the feature first. If `exec.run` was not declared, `abx exec` raises E8004 and does not send `exec.run`.

Two paths do **not** go through your plugin:

- `abx create` with no `--provider`, no `ABX_PROVIDER`, and no config default stays on `alicloud-express`.
- `abx create "a node api"` (a description, no `--template`) first runs the built-in template authoring pipeline (generate, build, deploy). Only the final `Sandbox.create` uses the selected provider. A provider without `templates.build` should be launched with `abx --provider my-cloud create --template <image-or-name>`.

`Sandbox.create(template="base", provider="my-cloud")` in Python is step 2 onward. It does not pass through the CLI. The installed plugin is still `~/.abx/providers/my-cloud`.

Working examples (copy one):

| Plugin | Kind | Shows | Source |
|---|---|---|---|
| `e2b-compatible` | `rest` | A manifest only: any E2B-protocol endpoint, consented `inherit` of the generic `sandbox_*` keys | `python-sdk/examples/providers/e2b-compatible/` |
| `local-process` | `exec`, Python stdlib | lifecycle, exec (buffered and streamed), files, a secret and a bool option | `python-sdk/examples/providers/local-process/` |
| `opensandbox` | `node`, EPP methods in process | OpenSandbox HTTP, execd SSE, and PTY through `kit.epp.infra`. `python -m agent_sandbox.providers install registry:opensandbox --yes` | [awesome-providers/opensandbox](../../../awesome-providers/opensandbox) |

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
secret = true                            # stored in ~/.abx/.env as ABX_MY_CLOUD_API_KEY, masked everywhere
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
- Declare every feature you implement, and only those. A command that needs an undeclared feature fails with `E8004` before any request is made, so a missing method is never an `AttributeError` or a 404. This holds for `exec` plugins and for `rest` presets alike (a `rest` manifest that omits `files.rw` makes every file call `E8004` without touching the network). `abx provider list` shows the declared features of each provider.
- Option names are `[a-z][a-z0-9_]*`. Canonical environment names are derived: `ABX_<PROVIDER_ID>_<KEY>` (dashes become underscores). Add `env = ["VENDOR_NAME"]` to accept the backend's native variable too.
- `abx provider info my-cloud` shows what the user will see; `abx provider install ./my-cloud --link --yes` installs in place while developing.

## 2. The EPP/1 methods

The CLI calls these over stdin/stdout (the authoritative list is `docs/design/fixtures/epp-methods.json`):

| Group | Methods the host sends |
|---|---|
| handshake | `initialize` (config in, `features` out), `shutdown` |
| `sandbox.lifecycle` | `sandbox.create`, `sandbox.get`, `sandbox.list`, `sandbox.kill`. `sandbox.connect` is optional: on `-32601` the host calls `sandbox.get` |
| `sandbox.timeout` / `sandbox.pause` | `sandbox.set_timeout`, `sandbox.pause`, `sandbox.resume` |
| `exec.run` / `exec.stream` | `exec.run` (buffered). Streaming is `exec.start`, then `exec.output` / `exec.exit` notifications |
| `process.manage` | `process.list`, `process.kill`, `process.signal`, `process.stdin` |
| `files.rw` | `files.read`, `files.write`, `files.list`, `files.stat`, `files.mkdir`, `files.remove`, `files.move`. `files.search` and `files.chmod` are extensions the host does not call yet |
| `ports.url` | `ports.url` |

`sandbox.create` must return a record with `sandbox_id`. Also returned when you have them: `template`, `status`, `metadata`, `envd_url` (or `url`), `envd_access_token`, `created_at`, `expires_at`, `region`. No `envd_url` means the host keeps talking to you over EPP (`epp://<id>/<sandbox_id>`). An `http(s)` `envd_url` means later file, process, and terminal calls use the E2B envd transport instead of your plugin.

Errors use JSON-RPC codes plus `data.sdk_code`. Three outcomes are worth getting right, because scripts match on the code:

| Situation | JSON-RPC | What the user sees |
|---|---|---|
| The provider lacks a feature | `-32003` (the host also raises it itself when the feature is not declared) | `E8004` "Provider 'x' does not support 'feature'" |
| A `sandbox.get` / `connect` / `set_timeout` / `pause` / `resume` names an unknown sandbox | `-32002` (optionally `data.sdk_code = "E2009"`) | `E2009`, exit 4, the same code as on the built-in provider |
| Any other missing thing (a template, a file, a process) | `-32002` with `data.sdk_code` such as `E4001` or `E2001` | that SDK error; `E8005` when none is given |

`sandbox.kill` of an unknown sandbox is not an error (the host treats it as done), so a plugin may either succeed or answer `-32002`. Sandbox ids returned by the plugin are bare; the CLI qualifies them as `my-cloud:<id>` when printing. `ProcessInfo.pid` may be a number or a string.

A backend that already speaks the E2B envd data plane only needs the control plane (create, connect, list, kill) plus the envd URL in the result: commands, files and terminals then use the native fast transports. A backend without envd implements `exec.*` and `files.*` as well.

## 3. Develop and verify

```bash
abx provider install ./my-cloud --link --yes       # in place, no integrity check (development only)
abx provider doctor my-cloud                       # manifest, requires, configuration completeness, handshake
abx config set providers.my-cloud.api_key          # masked prompt
abx provider test my-cloud -o region=eu-1          # the contract suite (18 cases; unsupported features are skipped)
abx --provider my-cloud create --template base
```

`abx provider test` runs the same contract kit that the reference plugins pass: lifecycle, exec, streaming, files, process control, timeouts, error mapping. Unit-test your plugin without the CLI by driving the process with NDJSON on stdin.

### `node/1` plugins (in-process)

When the backend speaks the E2B wire shape (REST control plane plus an envd data plane), you do not need a child process. A `node` plugin is an ES module the host loads in its own process through a small kit, so the CLI, the engine and every SDK run the same code. `e2b`, `cubesandbox` and `alicloud-container` in [`awesome-providers`](https://github.com/Alibaba-Agent-Sandbox/awesome-providers) are examples.

```toml
[compat]
protocol = "node/1"
requires = { sdk = ">=0.3", cli = ">=0.3" }

[runtime]
kind  = "node"
entry = "provider.mjs"            # inside the plugin directory
```

```js
export default function create(kit) {
  return {
    async buildInfra(ctx) {
      const base_url = String(ctx.options.base_url || "https://api.example.com");
      const auth = ctx.headerKeyAuth(String(ctx.options.api_key), "X-API-Key");
      const http = ctx.http({ base_url, domain: "example.app", auth });
      return {
        auth,
        http_client: http,
        endpoint: { base_url, domain: "example.app" },
        sandbox_protocol: new kit.SandboxProtocol(http),
        process_protocol: new kit.ProcessProtocol(http),
        filesystem_protocol: new kit.FilesystemProtocol(http),
        code_interpreter_protocol: new kit.CodeInterpreterProtocol(http),
      };
    },
  };
}
```

- `ctx` has `id`, `features`, `options` (only the fields you declared), `core` (the generic keys you consented to), `http(opts)`, `headerKeyAuth(key, header)` and `noAuth()`.
- `kit` has `SandboxProtocol`, `ProcessProtocol`, `FilesystemProtocol`, `CodeInterpreterProtocol`, `errors`, `hostVersion`, `e2b { resumeConnect, withDefault, overlay, parseExecution }` and `epp.infra(ctx, factory)` (run a module that exports an EPP/1 dispatcher in the host process and adapt it to the protocol objects; OpenSandbox does this). Subclass a protocol or wrap one with `kit.e2b.overlay(inner, { method })` to change one call.
- Ask the host for two E2B quirks in the `buildInfra` result: `envd_dial: [host, port]` (connect to this TCP target while the `Host` header stays the virtual name) and `envd_auth: { allow_missing, basic_user }` (an optional envd token, and the Basic user to send with it).
- The host checks the plugin tree digest on every load (unless installed with `--link`), and gates each protocol by the features you declared. A plugin runs with the host's privileges, so install only what you trust; `[security]` is advisory.
- Use `exec` instead when the plugin must be isolated, written in another language, or reuse an existing SDK (a third-party plugin does; OpenSandbox's own methods also run in process through `kit.epp.infra`).

### Authoring checklist

1. `abx-provider.toml`: `manifest_version = 1`, a valid id, `[compat] protocol = "epp/1"` and `requires`, `[runtime] kind = "exec"` with a `command` that runs from the plugin directory. `abx provider install ./dir --link --yes` fails with an `E8014` message that names the broken field.
2. Required methods: `initialize` (return the features you implement) and `shutdown`. Then one group per feature you declare (table in section 2). `sandbox.connect` and the `ports.url` / `files.*` extras are optional.
3. Feature flags: declare exactly what works. The host never calls a method of an undeclared feature and answers `E8004` itself. Do not declare a feature "for later".
4. Errors: answer `-32003` for a feature you know you lack, `-32002` for a missing sandbox, and put an `sdk_code` on anything that has an SDK error class. Never put credentials in an error message; the host redacts declared secrets, but not your own copies.
5. Configuration: declare every option under `[config.fields.*]`; secrets get `secret = true`. Accept the vendor's own variable names with `env = [...]` so existing shells keep working. Do not read the environment yourself; the host passes configuration in `initialize`.
6. Contract tests: `abx provider test my-cloud` runs 18 cases (declared features are known, lifecycle, kill idempotency, timeouts, exec exit code / stderr / env / streaming order / timeout, process list, files round trip, binary and unicode, directories, typed not-found, ports, undeclared feature gives `E8004`, secrets are redacted from errors). Cases for features you did not declare are skipped, not failed. The same kit runs from Python with `python -m agent_sandbox.providers test my-cloud`.
7. Publish: pinned install instructions with a 40-hex commit (section 4), an honest `[security]` block, and a README with the consent-screen contents.

## 4. Publish and install from git

1. Put `abx-provider.toml` at the repository root, or in one subdirectory. Keep unit tests, fixtures, and anything you do not want hashed out of that directory.
2. Commit the plugin files. A tag or a branch is not a pin.
3. Copy the full 40-hex commit. That is the value users pass as `--ref`.

```bash
# interactive: prints the consent screen, then copies the tree
abx provider install https://github.com/you/abx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7

# plugin lives in providers/my-cloud inside a larger repo.
# // is the subdirectory, the same spelling as `abx template install owner/repo//subdir`.
abx provider install you/plugins//providers/my-cloud \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7

# CI, no TTY: --yes acknowledges the consent screen (exit 2 / E8012 without it)
abx provider install https://github.com/you/abx-provider-my-cloud.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7 --yes
```

What that command does:

- Git is fetched without checking the tree out. The installer writes the files itself. Nothing from the plugin runs during install.
- A tag or branch in `--ref` (or no `--ref`) is unpinned. An unpinned ref is accepted only after a person read the consent screen in a terminal (no `--yes`), or with `--allow-unpinned`. `--yes` on its own never accepts a moving ref: it fails with `E8012` and prints the commit to pin (`--ref <40-hex>`). The same rule applies to `abx provider update`.
- The consent screen shows the manifest summary (runtime command, features, security block, config fields, generic credentials the plugin will receive) and the tree digest. Without a terminal and without `--yes` the install stops with `E8012` and a re-run hint that keeps `--subdir` and the commit.
- `--sha256 <tree digest>` pins the tree and fails the install when the digest differs.
- `--subdir` must be a relative path inside the repo. Use it so large test suites stay out of the install: every file except `data/` is hashed into the tree digest, and that digest is checked again on every start (`E8011` when a file changed).
- URLs with embedded credentials are rejected. `file://`, `git://`, and `http://` need `--allow-insecure-transport` and are for development only.
- After install, `abx provider doctor <id>` checks the manifest, version requirement, configuration, and handshake. Move a pinned install with `abx provider update <id> --ref <new 40-hex commit>`.

Document the `[security]` block honestly: it is the user's only summary of what the plugin may touch, and the CLI does not sandbox the plugin process. The user-facing install rules are also in [Providers](providers.md#install-inspect-remove).

## 5. Template profile

The `[template]` table is for **template authoring only** (Dockerfile and code generation for `abx template init` / `deploy`). It does not decide what `abx create --template X` means: that string is passed to your plugin in `sandbox.create`, and you map it. OpenSandbox treats it as a container image URI (`python:3.12-slim`) and offers `default_image` and `image_aliases` options for short names; it has no `[template]` table and stays on the generic profile.

Optional `[template]` table. When the table is absent, template generation uses the generic Docker profile (`FROM python:3.12-slim`, `CMD ["python3", "commands.py"]`, `WORKDIR /app`) and says this provider had no profile. It does not use the Alibaba Cloud Express FC image. OpenSandbox stays on that generic profile; its create `entrypoint` is unchanged.

When the table is present, every required field below must be set. A missing or wrong field is `Invalid abx-provider.toml: [template] ...` and the plugin does not load.

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
start_cmd = "agent-sandbox-server serve --port 9000 --commands /opt/app/commands.py"
ready_cmd = "agent-sandbox-server healthcheck --port 9000"
arch = "linux/amd64"
workdir = "/opt/app"
reserved_ports = [5000]
registry = "pull by image URI; private-registry auth stays in provider config"
```

`commands.py` still imports only `agent_sandbox.server` and calls `serve(port=9000)` under `if __name__ == "__main__"`. The server package does not read this table.

The built-in `alicloud-express` profile is a constant in the CLI, not a plugin manifest: `server_start = "platform_start_cmd"`, workdir `/home/user/app`, reserved ports `49983`, `5000`, and `49999`, and an FC registry image whose region matches the sandbox region. A plugin that wants that image names it in its own `base_image`. A plugin that omits `[template]` never inherits it.
