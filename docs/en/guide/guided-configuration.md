# Guided configuration

When an operation needs configuration, `abx` checks the selected Provider and the operation's build or execution plan before starting work. In an interactive terminal, it can collect missing values and continue that operation. An account permission, quota, network failure, or unsupported capability still requires the corresponding remedy; it is not treated as a missing API key.

For the complete field and precedence rules, see the [configuration reference](../reference/configuration.md), [authentication](authentication.md), and [Providers guide](providers.md). The [migration guide](migrate-from-e2b.md) describes the separate standard and native command surfaces.

## Configure and continue

Run a command normally to use its setup flow:

```bash
abx create dev-services
abx template deploy ./dev-services --alias dev-services
```

Before requesting credentials, the flow shows the effective Provider, region, and API host. URL user information and query strings are excluded from this display. The flow lists the missing fields and offers these scopes once:

1. **Only this command** (default): use the values through the current operation's stages. No user configuration or project dotenv file is written.
2. **Save for future commands**: store supported settings in the selected Provider's declared user configuration location, then read them back before continuing.
3. **Cancel**: stop before starting the operation.

Secrets use hidden input. An invalid typed value can be entered again. Empty input cancels missing-value collection; it does not delete an existing credential. Inputs are collected before persistent writes begin. Each supported file write is atomic, but saving several fields is not a transaction: if a later write or cleanup fails, the diagnostic identifies completed fields or a possibly written field and the operation stops.

A value entered for only this command does not reach a later, separately invoked command. For example, a temporary build credential is not saved for a later deploy, and a temporary Sandbox API key used during MCP setup is not installed into an editor's process environment.

After saving, the flow reports the actual destination and modification command. Environment variables and project `.env` values retain their precedence. If they override a newly saved value, the flow explains the conflict rather than claiming that the saved value took effect.

## Ask only for the current operation

| Operation | Configuration checked |
| --- | --- |
| Standard Express sandbox commands | Sandbox API key and the effective service target |
| Official Dockerfile deployment | Platform AccessKey pair, ACR namespace and credentials required by that path, plus local Docker prerequisites |
| Platform build steps | Platform credentials and the effective region; no local Docker or ACR requirement |
| Image push | The registry configuration used by the push path; no template registration identity merely because other operations use one |
| Deploy from an existing image | The selected Provider's platform configuration, and missing paired private-registry fields when that mode is requested; no local Docker build |
| Template generation or real adoption | Coding tool and LLM configuration; cloud requirements are added only when deploying or creating a sandbox |
| Template launch | Known Provider/create requirements first, then build requirements after the source and plan are known |
| Built-in scaffold, local previews, download-only | Local inputs; no cloud credential setup merely to inspect or download files |
| Provider operations | Declared required fields and one usable authentication combination, with existing values reused |

The Sandbox API key used to create or connect to sandboxes is different from the Alibaba Cloud AccessKey pair used for platform build operations. Missing Express credentials lead to ABX setup instructions, not a request to log in to E2B. The standard entry retains documented compatibility environment names, but it does not use an unrelated `~/.e2b/config.json` login as its identity.

Provider-owned fields remain isolated, even when they share names such as `region` or `http2` with host settings. One complete declared authentication combination satisfies setup; the flow does not demand another combination as well. A missing or unusable Provider contract is reported instead of borrowing another Provider's credentials. Discovery, doctor, and multi-Provider aggregation keep their reporting roles. See [Provider operations](provider-commands.md).

## Automation and output modes

Configuration questions require terminal stdin, stdout, and stderr. They are disabled in CI, JSON or quiet output, pipes, and the existing `--yes`/`-y` operation mode. Missing required data produces the complete missing-field list and supported configuration commands; `-y` cannot supply a namespace or invent a secret.

Explicit setup behaves similarly:

```bash
abx config init
abx config init --build
abx config init --llm
abx config init -y
```

`config init -y` prints equivalent setup commands without collecting or writing values. Machine output remains machine readable. The standard Express parser continues to reject native-only global flags where it did before; configuration guidance does not add `--json` or `--ci` to unsupported standard commands.

The existing missing-directory exception remains: build/deploy with `-y` or CI consent may scaffold a missing Python project and continue. Existing files still have their separate conflict and overwrite protections. Creating project files is not a successful deployment.

## Review and change saved configuration

```bash
abx config list
abx config set sandbox_api_key
abx config set access_key_id
abx config set access_key_secret
abx config set acr_namespace
abx config set llm_api_key
```

Omit VALUE for terminal input, especially for secrets, so the value is not placed in shell history. Existing values are preserved on empty interactive input. To remove a saved value deliberately, use the explicit delete or unset operation:

```bash
abx config delete llm_api_key
abx provider config PROVIDER list
abx provider config PROVIDER set KEY
abx provider config PROVIDER unset KEY
```

Provider settings use their actual schema storage names. For example, Express `access_key_secret` uses `ALICLOUD_ACCESS_KEY_SECRET`; a Provider-scoped inherited Sandbox API key uses that Provider's scoped variable. The completion message names the actual file. User credential dotenv files are written with owner-only permissions. Unsupported dotenv interpolation or control characters are rejected before replacing the file; ordinary spaces, hashes, quotes, backslashes, and supported multiline values are preserved.

Malformed or unreadable TOML/dotenv files are diagnosed by source, without showing secret contents. Invalid explicit booleans, numbers, enums, or URLs are reported instead of silently falling back to defaults. Repair the identified source; setup does not replace a damaged file with an empty configuration.

## Project and local-tool guidance

A missing build/deploy directory can be created after confirmation. If an existing directory has neither a Dockerfile nor platform build steps, the terminal flow offers scaffolding, adapting existing code, choosing another directory, or cancelling. Explicit invalid Dockerfile paths and malformed YAML are reported rather than overwritten. File previews and replacement consent still apply. Browse source templates in the [template Registry](https://registry.agent-sandbox.cn/templates/).

Docker checks distinguish a missing executable from an inaccessible daemon or context. After fixing the local setup, you can request another check before building. The CLI does not run sudo, select a different Docker context, or start system services for you. GitHub rate-limit recovery retries the safe source read; access-denied and missing-reference errors remain distinct diagnostics.

## MCP setup and offline work

`abx mcp install` may offer Sandbox access setup, but editor registration can continue offline. Cursor, Claude, and VS Code registrations do not copy Sandbox API keys into IDE files. They retain the launch command and applicable non-secret target settings; the server reads credentials when it starts. Registering an IDE entry does not verify cloud access. Temporary setup values do not persist into a later IDE-launched process.

STDIO server execution never asks configuration questions or consumes JSON-RPC input for a wizard. Its stdout remains protocol traffic. Interactive HTTP startup can collect missing Sandbox access or a non-loopback Bearer token before serving. A non-loopback listener still requires a token; automation must provide the documented token option or environment variable.

`abx mcp deploy --generate-token --output-dir ./mcp-artifact` generates deployment files. Without a Sandbox key, explicitly continuing offline produces an artifact that cannot yet create sandboxes. A Bearer token remains required. The generated `config.yaml` contains deployment credentials and must be kept private; unlike IDE registration, that file is the explicit deployment destination. Artifact creation reports deployment and service verification separately and does not claim that a cloud service was deployed. See [MCP integration](mcp-integration.md).

## Safe continuation

Setup resumes the stage that has not yet started. It keeps the selected Provider, supported original options, generated project files, and known resource references. It does not replay code generation, Docker builds, pushes, template registration, or sandbox creation merely because a later request failed. After a timeout or ambiguous cloud submission, inspect the reported resource and use the existing query commands before retrying. No automatic configuration wizard grants permissions, activates an unavailable service, or proves remote credentials valid just because local fields are complete.
