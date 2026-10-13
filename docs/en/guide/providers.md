# Providers

A **provider** is a sandbox backend. `ebx` ships one built-in provider and can drive more through installable plugins. This page is the CLI view: install, select, configure and use providers from the command line. The shared concepts (manifest, trust model, EPP/1 protocol, capability matrix) are documented once in the Python SDK repository: [Providers guide](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/guide/providers.md) and [Providers and credentials design](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/en/design/providers-and-credentials.md). To write a plugin see [Authoring providers](authoring-providers.md).

| Id | Name | Kind | Default |
|---|---|---|---|
| `alicloud-express` | Alibaba Cloud Express Edition (阿里云极速版) | built-in | yes |

> **Nothing changes until you use a provider.** With no plugin installed and no provider selected, every command, every output byte and every environment variable behaves as in 0.2.x. The `provider` command group is hidden from `ebx --help` until a plugin is installed or a non-built-in default is set (it is always callable). The CLI package version is 0.3.0; the Python SDK pin in `python-sdk` is a separate release line.

---

## Install, inspect, remove

```bash
ebx provider list                                    # built-in first, then installed ones
ebx provider install ./my-provider                   # a local directory
ebx provider install https://github.com/acme/ebx-provider-acme.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7     # a git URL pinned to a full commit
ebx provider info my-cloud                           # manifest, features, options, trust, digest
ebx provider update --check                          # what would change (read-only)
ebx provider update my-cloud
ebx provider uninstall my-cloud                      # settings stay unless --purge
```

What `install` does and does not do:

- **Nothing from the plugin is executed while installing.** Git sources are fetched without a checkout, every tree entry is validated (regular files only, size and count limits) and the installer writes the files itself.
- It prints a **consent screen** (id, version, source, commit and digest, the command that will run, declared security block, features, options, and whether your generic sandbox credentials would be sent to the plugin). Without a terminal, and with `--json`, `--yes` is required (exit code 2, `E8012`).
- A source is **pinned** with a full 40-hex `--ref` or `--sha256 <tree digest>`. A tag or branch is unpinned and needs `--allow-unpinned`. `--link` makes an in-place development install without an integrity check. `--allow-insecure-transport` enables `file://`, `git://` and `http://` (tests and development only). URLs with embedded credentials are rejected (`E8012`).
- The tree digest is verified every time the plugin starts (`E8011` when files changed). `--force` replaces an existing install of the same id.

Check a provider without side effects on the backend:

```bash
ebx provider doctor my-cloud            # installed / integrity / configuration / handshake, exit 1 on failure
ebx provider test my-cloud -o region=eu # the contract suite through the same adapters the CLI uses
```

---

## Choose a provider

Highest priority first:

| Where | Example |
|---|---|
| Qualified reference | `ebx kill my-cloud:sbx-1` |
| Flag (any position) | `ebx create --provider my-cloud --template base` |
| Process environment | `export EBX_PROVIDER=my-cloud` |
| `./.env`, then `~/.ebx/.env` | `EBX_PROVIDER=my-cloud` |
| `~/.ebx/config.toml` | `[core]` `provider = "my-cloud"` (`ebx provider default my-cloud`, `ebx config set provider my-cloud`) |
| Built-in | `alicloud-express` |

```bash
ebx provider default                   # effective default, one line (--json: {"default": ..., "source": ...})
ebx provider default my-cloud          # persist it
ebx provider default --unset           # back to alicloud-express
```

An unknown id exits with 4 (`E8001`). Provider options for one command are given with `--opt KEY=VALUE` (repeatable, any position); options marked `secret` in the manifest are refused on the command line (`E8002`) so that secrets never reach shell history, set them with `ebx config set providers.<id>.<key>` instead.

### Sandbox ids are qualified

Every command that takes a sandbox id accepts `[provider:]sandbox_id`; the prefix counts only when it names a known provider. `--provider P` together with a reference `Q:id` where `P` differs from `Q` fails with `E8030` (exit 2).

Printed ids follow one rule: the **legacy format** (bare ids, no `provider` field) is used only when both the configured default and the effective provider are `alicloud-express`, so scripts that only use the built-in provider see no change. In every other case ids are printed as `local-process:sbx-1` in text mode and `--json` rows gain `"provider"`.

```bash
ebx --provider local-process create --template base      # ID: local-process:sbx-1
ebx exec local-process:sbx-1 "echo hello"
ebx list --all-providers                                 # every configured provider, with a Provider column
ebx kill local-process:sbx-1 --yes
```

`list --all-providers` skips a provider that fails (for example, missing credentials) with `warning: provider 'ID' skipped: ...` on stderr and exits 0 when at least one provider answered. `--region` and the other built-in provider flags are refused for a provider that does not declare the matching key: `Option '--region' is not supported by provider 'ID'.`

A command that needs a feature the provider does not declare (for example `ebx sandbox process` on a provider without `process.*`) fails with `E8004` before any request is sent.

---

## Credentials and configuration keys

Every key has one name. Settings that belong to Easy Sandbox use `EBX_`. When a vendor already publishes a variable, that variable is the name. It is not wrapped in `EBX_`.

| Key | Environment variable | Why this name |
|---|---|---|
| `provider` | `EBX_PROVIDER` | product setting |
| `sandbox_api_key` | `EBX_SANDBOX_API_KEY` | product sandbox key |
| `sandbox_base_url` | `EBX_SANDBOX_BASE_URL` | product platform URL |
| `sandbox_domain` | `EBX_SANDBOX_DOMAIN` | product data-plane domain |
| `llm_api_key` | `EBX_LLM_API_KEY` | product codegen key. The Qwen Code child receives it as `OPENAI_API_KEY`, because that is the variable the `qwen` program reads |
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
| `team_id` | `EBX_ALICLOUD_EXPRESS_TEAM_ID` | no Alibaba Cloud variable for this; the provider prefix is used |
| plugin option `<key>` | `EBX_<PROVIDER_ID>_<KEY>` | a third-party provider with no single official variable |

Resolution order for one key: command-line override, process environment, `./.env`, `~/.ebx/.env`, `[providers.<id>]` and `[transport]` in `~/.ebx/config.toml`, derived value, default. Blank values count as unset. Plugins receive **only** the options they declare and the generic keys you consented to at install (`[core] inherit`); everything else stays out of their environment.

`ebx config` addresses all of them:

```bash
ebx config set sandbox_base_url https://api.example.com
ebx config set acr_repo my-repo                              # built-in provider key (stored in [providers.alicloud-express])
ebx config set providers.my-cloud.region eu-1                # qualified: one provider's option
ebx config set --provider my-cloud region eu-1 # bare key of the effective provider
ebx config set providers.my-cloud.token                      # secret: masked prompt, stored in ~/.ebx/.env
ebx config get providers.my-cloud.token                      # always masked
ebx config list --provider my-cloud                          # the provider's keys and where each value comes from
```

A bare key that exists only in another installed provider is rejected with `Did you mean 'providers.<id>.<key>'?`. `ebx provider config <id> list|get|set|unset|init` is the same surface scoped to one provider.

`ebx config list` prints the names in the table above. A name that is not in the table is not read.

---

## Exit codes and errors

| Code | Exit | Meaning |
|---|---|---|
| `E8001` provider not found | 4 | not installed; see `ebx provider list` |
| `E8002` configuration | 2 | unknown or invalid option, secret on the command line |
| `E8003` conflict | 1 | already installed (use `--force`) |
| `E8004` feature not supported | 1 | the provider does not implement the feature |
| `E8005` resource not found | 4 | the provider could not find the sandbox/template/file |
| `E8010`-`E8014` install, integrity, trust, version, manifest | 1 or 2 | `E8012` and `E8002`-class trust problems exit 2 |
| `E8020`-`E8022` protocol, process, timeout | 1 or 5 | plugin misbehaved or timed out (timeout exits 5) |
| `E8030` reference mismatch | 2 | `--provider P` with `Q:id` |
| `E2009` sandbox not found | 4 | a killed or expired sandbox |

Full list: [Error codes](../reference/error-codes.md). Every `provider` subcommand honours `--json`, `--quiet`, `--ci` and `--no-color`.

---

## Try it locally

The repository ships an end-to-end script that installs the reference plugins and drives a real sandbox through them: [`e2e/README.md`](../../../e2e/README.md) (`e2e/providers/run.sh`).
