# Environment Variables in Sandboxes (CLI)

[中文](../../zh/guide/environment-variables.md)

The CLI's own configuration and a sandbox process's environment are different inputs. Project configuration uses `ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL` and `ABX_SANDBOX_DOMAIN`; the pinned standard Express entry also accepts its documented E2B settings. See [configuration](../reference/configuration.md) and [standard migration](migrate-from-e2b.md). This page describes the current public CLI 0.5.6; provider extensions depend on the selected provider's supported operations.

## Configure the application before launch

For template applications, use one startup owner. Configure the environment variables already declared by the selected template before `abx template launch`. Securely configure `ABX_SERVER_TOKEN` and any model settings required by the selected template's README, then launch:

```bash
abx --provider alicloud-express template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
abx --provider alicloud-express run <sandbox-id> hello --arg name=Ada
```

Replace `<sandbox-id>` with the returned ID. `abx run` calls the named-command application over HTTP; it is not an envd shell command. The application reads its startup environment, while `ABX_SERVER_TOKEN` in the caller authenticates the request. Starting another client does not reconfigure the existing application. See [template startup](template-workflows.md) for configuration and owned sandbox/template/image cleanup.

Creation input, a process environment and an already running application's environment are distinct. An application may itself be started through envd; every sandbox need not have two independent process trees or an envd process with PID 1. A process's later environment changes do not rewrite its existing parent or siblings. Do not infer universal inheritance from one successful variable: a provider/runtime may retain its platform `PATH`.

## Terminal variables on the standard Express entry

`abx create` and `abx connect` accept repeatable `--env` / `-e KEY=VALUE` for the terminal session:

```bash
abx --provider alicloud-express create base --env APP_ENV=staging
abx --provider alicloud-express connect --env APP_ENV=staging <sandbox-id>
```

The first command creates an instance and opens a terminal. Its `--env` values are passed to that terminal, not to the lifetime creation request. `create --detach` does not open a terminal and does not turn `--env` into instance-wide injection. For Python creation-time `ProviderSandbox.create(envs=...)`, use the [SDK environment guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/environment-variables.md); do not apply the terminal flag's semantics to another provider's creation API.

Only delete an instance you own when finished, for example `abx --provider alicloud-express kill <sandbox-id>`. Attaching to somebody else's sandbox does not transfer its ownership.

## Override or read a process environment

Place standard Express exec options before the sandbox ID. A per-command override applies to that process and its children, not to an already running application or future sibling commands:

```bash
abx --provider alicloud-express exec --env MY_KEY=one <sandbox-id> printenv MY_KEY
abx --provider alicloud-express exec <sandbox-id> printenv HOME
abx --provider alicloud-express sandbox system env <sandbox-id> --filter PATH,HOME,LANG
```

`abx sandbox system env` runs `env` in a new sandbox process, then filters the output. It does **not** call the application's `GET /env` or report an arbitrary already running server's environment. Names containing `TOKEN`, `SECRET`, `KEY`, `PASSWORD` or `CREDENTIAL` are excluded by this command. Avoid printing secrets with an unfiltered process command.

Other providers use their declared process operation and supported flags; consult that provider's help. Explicit process `env` is useful when a required `PATH` must be supplied instead of assuming creation-time replacement.

## Shell behavior depends on the entry

The standard Express exec entry renders the remote command and runs it through `/bin/bash -l -c`. One quoted command string is shell input; multiple arguments are quoted individually when building that string. Login-shell initialization may also affect the resulting environment. The native project process path instead directly executes simple commands and wraps detected unquoted shell operators in `sh -c`. Its simple `$VAR` and glob handling must not be presented as the behavior of every `abx exec` entry.

Use `printenv` for a single variable. When you intend shell syntax, make that explicit and protect the remote expression from local expansion:

```bash
abx --provider alicloud-express exec <sandbox-id> sh -c 'printf "%s\n" "$HOME"'
abx --provider alicloud-express exec <sandbox-id> sh -c 'ls /tmp | head -n 5'
```

The outer single quotes preserve `$HOME` for the remote shell. Shell execution and supported process features remain provider-specific; neither this syntax nor a declared capability proves an untested backend works.

## Read or change the running application's environment

An application must expose and authorize its environment endpoints. Connect the published Python SDK to the already running sandbox, bind `await sandbox.application_client(9000, token=...)`, and use its existing `application.system.env(...)` / `application.system.set_env(...)` methods. The [SDK environment guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/environment-variables.md#server-scope--getpost-env) gives the authenticated example and policy requirements.

Application credentials and provider gateway credentials are separate; gateway headers alone are not an application token. `POST /env` affects that application and future children, not its parent or siblings, and does not automatically reinitialize values cached during startup. The application protects system variables and `ABX_*` settings. Use startup configuration for model credentials and other startup-only values.

## Quick reference

| Task | Entry | Scope |
|---|---|---|
| Configure a template application | Configure declared values before `template launch` | That application startup |
| Configure the standard Express terminal | `create --env` or `connect --env` | Terminal session |
| Override one process | `exec --env` before the standard sandbox ID | That process and its children |
| Read a process environment | `exec ... printenv` or `sandbox system env` | A newly executed process |
| Read or update application variables | Authenticated SDK application binding | Running application and future children |
