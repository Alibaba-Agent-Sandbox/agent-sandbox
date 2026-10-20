# Agent applications from one template

This preview uses one `template.yaml`. Existing sandbox fields remain at the root;
an optional `application` block selects the Agent runtime, deployment and hooks.
The template contract is owned by [awesome-templates](https://github.com/Alibaba-Agent-Sandbox/awesome-templates).
This CLI vendors its v3 schema with SHA256 `afaa4a30fd24a5c5e4f4e28465d421e7076e612ab75e20c1a33c1d582c385a50`.
V2/unversioned templates keep their existing sandbox behavior. Unknown versions and
application fields on v2 fail closed. Ordinary install/create never runs application hooks.

## Runtime choices

- `in-sandbox` + `sandbox-local-api`: the Agent/CLI runs in the sandbox. The direct
  client path stays lightweight; applying its application prepares a template and
  returns its exact provider reference. No external database or gateway is created.
- `external` + `python-remote-tools`: a trusted Python Agent loop runs outside the
  sandbox and binds generated code/file tools to the remote workspace. An FC Web
  gateway, Task worker and bounded dispatcher share a durable PostgreSQL store.

The gateway's location does not determine the Agent's location. Installing a coding
CLI into FC does not automatically give it remote tools. Runtime servers/client,
factories, authentication and local integration instructions are in the
[Python SDK](https://github.com/Alibaba-Agent-Sandbox/python-sdk).

## Explicit lifecycle

Build and review the application container beforehand; pin each FC image by digest.
For FC, set `application.deployment.adapter: serverless-devs-fc3` and provide exactly
one of `inline` (a literal Serverless Devs v3 project inside the template) or `project`
(an advanced, reviewed local s project). The inline path writes frozen plans and receipts under `.abx/app/` and runs the
generated s project in an isolated temporary directory; it needs no second user-maintained YAML.

```sh
abx app plan ./template.yaml
abx app apply PLAN_FILE --yes
abx app status RECEIPT_FILE
abx app reconcile RECEIPT_FILE --yes
abx app plan --destroy RECEIPT_FILE
abx app destroy DESTROY_PLAN_FILE --yes
```

Use the exact plan/receipt paths returned by the command. `plan` is offline: no
hook, provider build, `s plan` or cloud call runs. Plans expire after one hour and
bind the reviewed project inputs. Generated output belongs under `.abx/` or outside
the source directory. `status` reads the local receipt; `reconcile` observes remote
resources and may repeat the reviewed `afterReady` probes, never the deployment.
Local operation locks do not serialize separate CI hosts; shared deployment requires
an external lock and an exclusive revision namespace.

FC preflight resolves one explicit Serverless Devs credential profile and shares the
same AK/STS snapshot with native inspection and SD. Atomic `CreateFunction` refuses
existing function names. Each returned native incarnation is saved immediately;
SD subsequently handles only triggers and async invocation configuration, using
`deploy --trigger --async-invoke-config`, never a function upsert. Updates use fresh
revision function names. This preview does not switch a production alias atomically.

Ready requires native account/name/incarnation checks, planned image digest,
Active state, successful update state when reported, gateway protocol/revision
health and reviewed `afterReady` hooks. Receipts retain native IDs, creation times,
resource scope and uncertainty, never raw `s info` or credentials. Destruction is a
separate plan; it verifies ownership and absence instead of trusting remove exit 0. Cleanup uses the frozen receipt and remains possible after ordinary source edits; deployment hooks still require their original reviewed inputs.
Provider preparation must explicitly attest create-only ownership before its template
reference authorizes cleanup. Existing/reused references are never assumed owned.

## Locked toolchain

`application.deployment.toolchainLock` points to a JSON file:

```json
{
  "schemaVersion": 1,
  "node": {"sha256": "REPLACE_ME"},
  "serverlessDevs": {
    "directory": "/reviewed/s-bundle",
    "executable": "/reviewed/s-bundle/bin/s.js",
    "version": "REPLACE_ME",
    "sha256": "REPLACE_ME"
  },
  "fc3": {
    "directory": "/reviewed/fc3-bundle",
    "version": "REPLACE_ME",
    "sha256": "REPLACE_ME"
  }
}
```

These placeholders are deliberately invalid. Lock the actual Node executable and
complete installed tool bundles, including dependencies; a hash of the npm launcher
alone is insufficient. `toolDigest` in `src/application/config.ts` defines the
canonical tree digest (sorted relative paths and file SHA256, internal links bound
to contained targets). It does not silently download tools during apply. SD loads
the exact verified local fc3 directory, bypassing mutable component cache resolution.
Execution injection variables and component version overrides are removed. Every s invocation uses a fresh configuration home, with no ambient default-env overlay or global component plugin.

Only literal, prebuilt custom-container FC projects are supported initially. Dynamic
expressions, deploy actions, mutable image tags and unsupported native properties
fail explicitly. Prepare/build belongs before plan; hooks cannot rebuild accepted
inputs. The generated s file contains only reviewed values plus declared runtime
bindings derived from the provider's prepared reference.

## Hooks and runtime dependencies

`application.hooks.beforeApply` and `afterReady` are optional bounded host/CI commands
with explicit argv, cwd, timeout and environment allowlist. They exchange JSON via
`ABX_HOOK_CONTEXT_FILE` / `ABX_HOOK_RESULT_FILE`; exit 0 plus a matching `passed`
result is required. Results/diagnostics are bounded at 64 KiB. Unknown fields,
duplicate IDs, unsafe paths, invalid UTF-8 and mismatched operation IDs fail.
After-ready context includes redacted owned native IDs. Same-group child processes
are cleaned even after a successful hook; reviewed scripts still execute trusted
host code and need a controlled CI runner.

Supply existing PostgreSQL/identity/network bindings and a trusted runtime factory
in the container. Do not put credentials in `inline`, root environment values or
tool locks. Resolve runtime secrets by role/reference in the factory. The deployer
injects `ABX_APP_REVISION`, `ABX_APP_SANDBOX_TEMPLATE`, `ABX_APP_SANDBOX_PROVIDER` and
`ABX_APP_SPEC_JSON`; those names cannot be overridden in the template.

The reference runtime uses bounded database artifacts, not an implemented object
storage backend. Managed B progress relay/checkpointing and multiple deployment
backends remain later work. Local tests do not establish cloud IAM, FC timing,
actual model quality, artifact bucket integration or production deployment acceptance.
