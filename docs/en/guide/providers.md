# Providers

A **provider** is a sandbox backend. `abx` ships one built-in provider and can drive more through installable plugins. The official site is <https://www.agent-sandbox.cn>. The registry website is <https://registry.agent-sandbox.cn>. The CLI installs catalog providers from `alibaba-agent-sandbox/awesome-providers//<id>`. The Python SDK installer fetches `https://registry.agent-sandbox.cn/providers/index.json` (`ABX_PROVIDER_REGISTRY` overrides that URL). This page is the CLI view: install, select, configure and use providers from the command line. The shared concepts (manifest, trust model, EPP/1 protocol, capability matrix) are documented once in the Python SDK repository: [Providers guide](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/guide/providers.md) and [Providers and credentials design](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/en/design/providers-and-credentials.md). To write a plugin see [Authoring providers](authoring-providers.md).

| Id | Name | Kind | Default |
|---|---|---|---|
| `alicloud-express` | Alibaba Cloud Express Edition (阿里云极速版) | built-in | yes |

Without an explicit selection, the CLI uses `alicloud-express`. Use `abx --version` to check the installed CLI; The Python SDK follows a separate release line from the CLI, with matching client and server package versions. See [installation](binary-installation.md) for published CLI artifacts.

---

## Provider boundaries and unequal capabilities

Selecting a provider chooses its configuration and protocol adapter. Unsupported operations must fail with E8004 on that provider; they must never retry against alicloud-express. Explicit provider:sandbox-id references retain ownership even when the default changes. An unknown namespace raises E8001 and an empty sandbox id raises E8002 before backend requests. Explicit provider/reference conflicts raise E8030.

The standard E2B command frontend is used only for Express. Qualified sandbox references enter the provider router. Other providers currently retain the project CLI syntax; selecting one does not promise that every E2B-specific option or result model is implemented there. Local generation with template scaffold can use a generic Docker profile; that changes the image contract, not the cloud backend.

Template commands use the selected provider's implemented template manager or its specialized command handlers. Native FC/ACR handlers belong to Express. The public `abx --provider <id> template launch SOURCE` path uses provider-owned preparation and startup; OpenSandbox implements source preparation for the documented default recipe. Missing operations fail on the selected provider without silently switching to Express. See [launch a template](template-launch.md) for build/configuration requirements and [template workflows](template-workflows.md) for the operation checks. Natural-language cloud deployment still requires its own matching provider handler.

The built-in provider lists its own implemented adapter features explicitly; adding a host feature must not implicitly advertise it on Express. This adapter does not advertise storage.mount, network.vpc or ports.domain as generic sandbox operations. That does not mean Alibaba lacks those cloud capabilities: resource administration and mount integration need their own implemented, verified entry points. Pause also depends on runtime/function enablement; a declaration alone is not account availability.

| Capability situation | Required behavior |
|---|---|
| Selected provider implements a common operation | Invoke its adapter, even when Express has no equivalent |
| Selected provider lacks the operation | E8004, with no cross-provider fallback |
| Only another provider implements it | Explicitly select that provider; do not silently borrow its backend |
| Backend/account/template/version prerequisite is unmet | Report the unmet prerequisite or original backend error; do not report success |
| Provider-specific cloud management | Use a declared, typed command and its actual provider handler |

The accepted [CLI provider management commands](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35) and [SDK companion](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38) provide discovery, schemas and explicit provider handlers. Registration does not create backend permissions or replace real E2E acceptance. Management commands and the fixed feature registry have separate roles.


## Install, inspect, remove

```bash
abx provider list                                    # built-in first, then installed ones, with each one's declared features
abx provider install ./my-provider                   # a local directory
abx provider install https://github.com/acme/abx-provider-acme.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7     # a git URL pinned to a full commit
abx provider info my-cloud                           # manifest, features, options, trust, digest
abx provider update --check                          # what would change (read-only)
abx provider update my-cloud
abx provider uninstall my-cloud                      # settings stay unless --purge
```

What `install` does and does not do:

- **Before consent, inspection reads static metadata without executing the plugin.** Git sources are fetched without a checkout, every tree entry is validated (regular files only, size and count limits) and the installer writes the files itself. After consent, default installation verification may import and initialize the plugin for its handshake.
- It prints a **consent screen** (id, version, source, commit and digest, the command that will run, declared security block, features, options, and whether your generic sandbox credentials would be sent to the plugin). Without a terminal, and with `--json`, `--yes` is required (exit code 2, `E8012`).
- A source is **pinned** with a full 40-hex `--ref` or `--sha256 <tree digest>`. A tag or branch is unpinned: it is accepted only after you read the consent screen in a terminal (no `--yes`) or with `--allow-unpinned`; `--yes` alone refuses it (`E8012`) and prints the commit to pin. `abx provider update` follows the same rule. `--link` makes an in-place development install without an integrity check. `--allow-insecure-transport` enables `file://`, `git://` and `http://` (tests and development only). URLs with embedded credentials are rejected (`E8012`).
- The tree digest is verified every time the plugin starts (`E8011` when files changed). `--force` replaces an existing install of the same id.

Installation and update report source inspection, Git fetching, file/manifest/digest validation, store writing and post-consent handshake verification on stderr. An interactive terminal also shows elapsed seconds for the current stage. `--yes` skips consent but keeps progress; `--json` and `--quiet` suppress progress. Each Git operation has a 120-second timeout. Timeouts and network/authentication failures are not automatically retried; a server that explicitly rejects shallow fetch gets one announced retry without depth. If fetching times out, check connectivity to the source host (or the SSH agent for SSH URLs), or clone the repository yourself and install its plugin directory locally. A completed install does not start an OpenSandbox server or create a cloud sandbox.

Check a provider without side effects on the backend:

```bash
abx provider doctor my-cloud            # installed / integrity / configuration / handshake, exit 1 on failure
abx provider test my-cloud -o region=eu # the contract suite through the same adapters the CLI uses
```

---

## Choose a provider

Highest priority first:

| Where | Example |
|---|---|
| Qualified reference | `abx kill my-cloud:sbx-1` |
| Flag (before the sandbox ID for exec) | `abx create --provider my-cloud --template base` |
| Process environment | `export ABX_PROVIDER=my-cloud` |
| `./.env`, then `~/.abx/.env` | `ABX_PROVIDER=my-cloud` |
| `~/.abx/config.toml` | `[core]` `provider = "my-cloud"` (`abx provider default my-cloud`, `abx config set provider my-cloud`) |
| Built-in | `alicloud-express` |

```bash
abx provider default                   # effective default, one line (--json: {"default": ..., "source": ...})
abx provider default my-cloud          # persist it
abx provider default --unset           # back to alicloud-express
```

An unknown id exits with 4 (`E8001`). Provider options for one command are given with `--opt KEY=VALUE` (repeatable; before the sandbox ID for exec); options marked `secret` in the manifest are refused on the command line (`E8002`) so that secrets never reach shell history, set them with `abx config set providers.<id>.<key>` instead.

### Sandbox ids are qualified

Every command that takes a sandbox id accepts `[provider:]sandbox_id`; the prefix counts only when it names a known provider. `--provider P` together with a reference `Q:id` where `P` differs from `Q` fails with `E8030` (exit 2).

Printed IDs use `provider:sandbox_id` for every provider, and JSON rows include `provider` while retaining the bare ID field.

```bash
abx --provider local-process create --template base      # ID: local-process:sbx-1
abx exec local-process:sbx-1 "echo hello"
abx list --all-providers                                 # every configured provider, with a Provider column
abx kill local-process:sbx-1 --yes
```

`list --all-providers` is an explicit native project extension even when Express is the default; ordinary list filters follow the standard contract. It skips a provider that fails (for example, missing credentials) with `warning: provider 'ID' skipped: ...` on stderr and exits 0 when at least one provider answered. `--region` and the other built-in provider flags are refused for a provider that does not declare the matching key: `Option '--region' is not supported by provider 'ID'.`

A command that needs a feature the provider does not declare (for example `abx sandbox process` on a provider without `process.manage`) fails with `E8004` before any request is sent.

---

## What you can run after installing

Installing a plugin does not implement every interface. Inspect `abx provider info <id>` and check the exact operations required by the selected client and [template workflow](template-workflows.md). Manifest declarations, client implementation and the backend response each affect whether a call succeeds.

| Task | CLI | Python ProviderSandbox |
|---|---|---|
| Create, connect and clean up | `create`, `connect`, `kill` | `ProviderSandbox.create/connect`, instance `kill/close`; `close` releases only the local client |
| Execute a process | `exec` | `commands.run` |
| Read and write files | `upload`, `download` | `files.read/write` |
| Call a template application | `run`, `sandbox command run`; see [command reference](../reference/cli-commands.md) | `await application_client(port, token=...)`, then `client.commands.run` |
| Resolve an application endpoint | No standalone URL command | `await network.resolve(port)` returns the URL and gateway headers |
| Prepare source and launch | `template launch`; see [launch guide](template-launch.md) | Prepare with the CLI, then connect to its sandbox or use the prepared reference |

Process execution, application commands, interpreters and PTY are separate interfaces. Supporting one does not imply the others. A provider's EPP transport does not itself prevent calling an application over HTTP: the selected workflow must expose a reachable application endpoint and satisfy its authentication contract. Preserve gateway headers and supply the application token explicitly.

Workflow planning checks specific provider operations and consumer support; see [template workflows](template-workflows.md). `abx info` and `abx list` print `-` for a region or timeout the provider does not report.

A manifest with `kind = "python"` is not installable. Programmatic Python `Provider` subclasses remain available in the Python SDK. An `exec` plugin may still use a Python executable and the EPP protocol.

### Catalog providers

The four catalog providers use Node.js plugins hosted by the CLI. The CLI and Python SDK can consume these installed plugins:

- `opensandbox`, `e2b`, `cubesandbox` and `alicloud-container` are all `node` plugins: an ES module the host loads in-process through a small kit (see [Authoring providers](authoring-providers.md)).

```bash
abx provider install alibaba-agent-sandbox/awesome-providers//e2b
abx provider install alibaba-agent-sandbox/awesome-providers//cubesandbox
abx provider install alibaba-agent-sandbox/awesome-providers//alicloud-container
abx provider install alibaba-agent-sandbox/awesome-providers//opensandbox
abx --provider cubesandbox --opt base_url=http://127.0.0.1:3000 create
```

A non-interactive install needs `--yes`. An unpinned git ref also needs `--allow-unpinned`, or a 40-hex `--ref`. The Python SDK installer is `python -m agent_sandbox.providers install registry:<id> --yes`.

The Python SDK reaches these plugins through the local engine, `abx provider engine serve`, which starts on demand. See [Engine HTTP API](../reference/engine-api.md). The independent [Node SDK](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk) currently provides an application HTTP client; it does not create cloud sandboxes or consume provider plugins. Other language clients would need an engine integration before making that claim.

| Id | Kind | Page |
|---|---|---|
| `opensandbox` | `node` | [OpenSandbox provider](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/opensandbox) |
| `alicloud-container` | `node` | [Container edition](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/alicloud-container) |
| `cubesandbox` | `node` | [CubeSandbox provider](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/cubesandbox) |
| `e2b` | `node` | [E2B provider](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/e2b) |

OpenSandbox talks to a local server. Set `ABX_OPENSANDBOX_BASE_URL` (default `http://127.0.0.1:8080`) and, when the server requires a key, `ABX_OPENSANDBOX_API_KEY`. The capability table on each page is the one to follow, including calls that return `E8004`.

---

## Credentials and configuration keys

Every key has one name. Settings that belong to Agent Sandbox use `ABX_`. When a vendor already publishes a variable, that variable is the name. It is not wrapped in `ABX_`.

| Key | Environment variable | Why this name |
|---|---|---|
| `provider` | `ABX_PROVIDER` | product setting |
| `sandbox_api_key` | `ABX_SANDBOX_API_KEY` | product sandbox key |
| `sandbox_base_url` | `ABX_SANDBOX_BASE_URL` | product platform URL |
| `sandbox_domain` | `ABX_SANDBOX_DOMAIN` | product data-plane domain |
| `llm_api_key` | `ABX_LLM_API_KEY` | product codegen key. The Qwen Code child receives it as `OPENAI_API_KEY`, because that is the variable the `qwen` program reads |
| `github_token` | `GITHUB_TOKEN` | GitHub's variable |
| `region` | `ALIBABA_CLOUD_REGION_ID` | Alibaba Cloud region variable |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | Alibaba Cloud AccessKey ID |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | Alibaba Cloud AccessKey secret |
| `acr_namespace` | `ACR_NAMESPACE` | registry namespace |
| `acr_registry` | `ACR_REGISTRY` | registry host |
| `acr_repo` | `ACR_REPO` | repository |
| `acr_username` | `ACR_USERNAME` | registry user |
| `acr_password` | `ACR_PASSWORD` | registry password |
| `acr_instance_id` | `ACREE_INSTANCE_ID` | ACR Enterprise instance |
| `acr_vpc_id` | `ACR_VPC_ID` | ACR Enterprise VPC |
| `acr_vswitch_ids` | `ACR_VSWITCH_IDS` | ACR Enterprise vSwitches |
| `acr_security_group_id` | `ACR_SECURITY_GROUP_ID` | ACR Enterprise security group |
| `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` | no Alibaba Cloud variable for this; the provider prefix is used |
| plugin option `<key>` | `ABX_<PROVIDER_ID>_<KEY>` | a third-party provider with no single official variable |

Resolution order for one key: command-line override, process environment, `./.env`, `~/.abx/.env`, `[providers.<id>]` and `[transport]` in `~/.abx/config.toml`, derived value, default. Blank values count as unset. Plugins receive **only** the options they declare and the generic keys you consented to at install (`[core] inherit`); everything else stays out of their environment.

`abx config` addresses all of them:

```bash
abx config set sandbox_base_url https://api.example.com
abx config set acr_repo my-repo                              # built-in provider key (stored in [providers.alicloud-express])
abx config set providers.my-cloud.region eu-1                # qualified: one provider's option
abx config set --provider my-cloud region eu-1 # bare key of the effective provider
abx config set providers.my-cloud.token                      # secret: masked prompt, stored in ~/.abx/.env
abx config get providers.my-cloud.token                      # always masked
abx config list --provider my-cloud                          # the provider's keys and where each value comes from
```

A bare key that exists only in another installed provider is rejected with `Did you mean 'providers.<id>.<key>'?`. `abx provider config <id> list|get|set|unset|init` is the same surface scoped to one provider.

`abx config list` prints the names in the table above. A name that is not in the table is not read. For the built-in provider that means `ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL`, `ABX_SANDBOX_DOMAIN`, `ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET`, and `ALIBABA_CLOUD_REGION_ID`. `E2B_API_KEY`, `E2B_API_URL`, `E2B_DOMAIN`, `AccessKey`, `AccessSecret`, `ALIBABA_CLOUD_ACCESS_KEY_ID`, and `ALIBABA_CLOUD_ACCESS_KEY_SECRET` are not read. A missing credential error lists the names that are read.

The preceding table and policy apply to native providers and MCP. The standard Express entry also maps `E2B_API_KEY`, `E2B_API_URL` and `E2B_DOMAIN` at its boundary and otherwise uses project configuration; see the [migration guide](migrate-from-e2b.md).

---

## Exit codes and errors

| Code | Exit | Meaning |
|---|---|---|
| `E8001` provider not found | 4 | not installed; see `abx provider list` |
| `E8002` configuration | 2 | unknown or invalid option, secret on the command line |
| `E8003` conflict | 1 | already installed (use `--force`) |
| `E8004` feature not supported | 1 | the provider does not implement the feature |
| `E8005` resource not found | 4 | the provider could not find a template, file or process (a missing sandbox is `E2009`) |
| `E8010`-`E8014` install, integrity, trust, version, manifest | 1 or 2 | `E8012` and `E8002`-class trust problems exit 2 |
| `E8020`-`E8022` protocol, process, timeout | 1 or 5 | plugin misbehaved or timed out (timeout exits 5) |
| `E8030` reference mismatch | 2 | `--provider P` with `Q:id` |
| `E2009` sandbox not found | 4 | an unknown, killed or expired sandbox, on every provider (built-in and plugins) |

Full list: [Error codes](../reference/error-codes.md). Every `provider` subcommand honours `--json`, `--quiet`, `--ci` and `--no-color`.

---

## Try it locally

The repository ships an end-to-end script that installs the reference plugins and drives a real sandbox through them: [`e2e/README.md`](../../../e2e/README.md) (`e2e/providers/run.sh`).

For project-provider exec, put --provider/--opt before the sandbox ID, and use `--` before remote commands containing options. Remote flags never change the selected backend; unsupported local parsing fails before backend work.
## Provider-specific management commands

Providers may declare typed commands under a fixed namespace. These differ from application commands inside a sandbox.

```bash
abx provider command list alicloud-express
abx provider command info alicloud-express volume.create
abx --json provider command run alicloud-express volume.list --input '{"max_results":10}'
```

Writes and deletes require `--yes`. Supply credentials through configuration; `--opt` rejects secret fields. Use `--input-file` for complex input. Discovery works without cloud credentials. FC commands require Alibaba Cloud AK/SK, and do not authenticate with a sandbox API key. See the [command contract](../design/provider-commands.md) and [Alibaba Cloud capability matrix](../design/alicloud-provider-commands.md), including custom-domain limits and safe API-key export.

To mount an existing FC Volume, use the native Python SDK `Sandbox.create(volume_mounts={"/mnt/workspace": "workspace"})` argument from the [SDK API reference](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/reference/api-reference.md). The default standard Express CLI does not expose the native `--volume-mount` option.
This selects the Volume by name and requires its Team's sandbox API key and a storage-access role.
It does not create underlying storage. Volume currently requires invitation access; confirm it through
an Alibaba Cloud support ticket as described in the [official OSS Volume guide](https://help.aliyun.com/zh/agent-sandbox/user-guide/create-oss-volume).
See the capability matrix for role configuration and mount verification.
Choose a mount-capable template; custom MicroVM source images must include ossfs2 2.0.10
or newer, as required by the [official mount guide](https://help.aliyun.com/zh/agent-sandbox/mount-oss-volume-1).

## Portability and provider updates

See [migration, ownership and updates](../design/provider-portability-and-updates.md) for the existing-resource adoption boundary, legacy FC template guards, provider-owned image factories and the distinction between Git/manual/bundled updates.

Native terminal access checks the selected provider's PTY declaration before wire
work. Internal Express template deployment checks ownership before credentials or
project files; natural-language deployment requires its matching adapter before
generation. Declaring templates.build alone does not authorize FC/ACR operations.
Resume/connect fallback applies only to404/405 endpoint absence; permission, conflict,
quota and service errors propagate instead of becoming successful metadata reads.

See [automatic project preparation and launch](template-launch.md) for per-provider prerequisites, reference handoff, readiness and cleanup.

See [Provider-owned commands](provider-commands.md) for shared CLI/Python discovery and the implemented Express pause/Snapshot extensions.

### Contract test skips

Framework adapters for `defineProviderContractTests` must supply `onSkip` and
mark the framework case skipped when a capability is absent. Without this adapter,
a skipped case now fails explicitly instead of being counted as passed.
`runContractSuite` continues to return structured `passed`, `failed` and `skipped`
outcomes. Report skipped capabilities separately from successful acceptance.
