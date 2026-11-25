# Invoke a Sandbox API

Use `abx sandbox TARGET OPERATION` to call a service in a specific Sandbox. The CLI reads operations and help from a fixed OpenAPI contract; the Sandbox's Provider supplies its actual address. This page describes the current source command layout, not the previously published 0.5.10 layout.

A contract does not install a service. Start with an existing Sandbox whose application listens on the declared port. An ordinary REST application can participate without Server SDK routes such as `/commands` or `/capabilities`, or shell execution. The Provider must support resolving application endpoints.

## Declare and bind

Keep [registry.yaml](../../examples/sandbox-api/registry.yaml), [openapi.yaml](../../examples/sandbox-api/openapi.yaml) and [request.json](../../examples/sandbox-api/request.json) together. They describe a report service; supply your own running implementation of `POST /totals` that returns `{"total":60}` for the sample request.

```yaml
apis:
  report:
    resource: sandbox.report
    port: 9000
    openapi: ./openapi.yaml
```

| Field | Meaning |
| --- | --- |
| `apis.report` | API name used with `--api report` |
| `resource` | Logical Sandbox label selected during binding, `sandbox.NAME` |
| `port` | Already running application's port, an integer from 1 to 65535 |
| `openapi` | Package-contained YAML/JSON file, relative to registry.yaml |

OpenAPI supplies method, path, `operationId`, parameter/body schemas, descriptions, response examples and security requirements. `servers` cannot override the actual Provider endpoint. A resource label does not create resources or prove that a service is installed.

A successful single-Sandbox `deploy` imports the source package's optional `registry.yaml.apis`. The current deploy path rejects an ambiguous multi-resource registry before deployment. Existing Sandboxes can select one declared resource with explicit `--bind ... --resource sandbox.NAME`. Packages without `apis` still deploy but need a binding to use this interface.

`report-demo` below is an existing local Sandbox deployment name; an actual Sandbox ID also works. Provider selection uses your existing configuration. For an explicit Provider, use `abx --provider opensandbox sandbox ID ...`. Put Provider options before TARGET; they cannot redirect a saved binding.

```bash
abx sandbox report-demo --bind ./registry.yaml \
  --credential report.token=env:REPORT_API_TOKEN \
  --alias totals=report:report_totals
```

Set `REPORT_API_TOKEN` in the shell through your secret-management mechanism to the application token accepted by this service. It is separate from cloud credentials and the Sandbox management key. Binding stores the variable name, not its value; it does not read application credentials or call the business API. It connects to the existing Sandbox to establish identity. For a service configured with the CLI-managed application token, explicitly choose `report.token=config:server_token` instead. Binding does not change the server's token.

`--bind` replaces this target's contract, credential references and aliases. Supply the full set again when rebinding. An alias maps to one `API:OPERATION_ID`, cannot shadow an operation ID, and is local to this binding. Bind references for exactly one authentication alternative required by an operation. If the contract explicitly allows anonymous access and no authenticated alternative is configured, anonymous access is used; an attempted authenticated request never retries anonymously.

The cache lives in `~/.abx/api-bindings` with private file permissions and contains the specification and routing metadata. Do not put secret literals into schemas or examples. Changing or deleting the original files does not update the saved contract; review and bind again after an API change. Help never rebinds.

## Discover and invoke

```bash
abx sandbox report-demo --help
abx sandbox report-demo report_totals --help
abx sandbox report-demo report_totals --body @request.json
abx sandbox report-demo totals --body '{"values":[10,20,30]}'
abx --json sandbox report-demo report_totals --api report --body @request.json
```

Target help lists operations and aliases. Operation help includes method/path, request schemas, responses/examples and authentication requirements. Both are offline and do not read credentials. Help shows declared behavior, not live availability or permissions.

HTTP output preserves status and body:

```json
{"status":200,"body":{"total":60}}
```

Non-2xx responses retain this structure and exit with code 1. Invalid input fails before connection. Unknown operations never fall back to shell execution. Requests are not retried or redirected. A timeout stops waiting; it does not prove remote execution stopped.

| Option | Usage |
| --- | --- |
| `--api NAME` | Select among APIs with duplicate operation IDs |
| `--body JSON` / `--body @FILE` | JSON body; objects, arrays and scalars follow the schema |
| `--path NAME=VALUE` | Repeat for declared path parameters |
| `--query NAME=VALUE` | Repeat for declared query parameters |
| `--header NAME=VALUE` | Declared non-authentication headers, without overriding gateway/transport headers |
| `--timeout SECONDS` | HTTP deadline, default 30; greater than 0 and at most 300 |

For a service that declares these operations and parameters:

```bash
abx sandbox report-demo get_report --path reportId=daily --query detailed=false
abx sandbox report-demo update_report --path reportId=daily \
  --header X-Request-Id=request-123 --body @request.json --timeout 60
```

These two names illustrate parameter combinations, not additional operations in the report example. `false`, `0` and explicit empty strings are not missing values. Unknown parameters and duplicate assignments fail. Schema defaults and examples are documentation; the CLI does not insert them automatically.

## Scope and lifecycle

Supported: OpenAPI 3.1, unique operation IDs within an API, internal JSON Pointer references, JSON bodies, scalar path/query/header parameters with standard simple/form serialization, Bearer and header API-key authentication. Unsupported: parameter objects/arrays, cookies, external or recursive references, schema formats, OAuth, cloud AK/SK signing, multipart, SSE and `x-abx-*` invocation extensions. Bundle external references before binding. Unsupported features fail explicitly. Response bodies are returned without response-schema validation.

Registry/OpenAPI files and request bodies are limited to 1 MiB each; bindings and HTTP responses to 8 MiB each. Provider, Sandbox ID and port are fixed. Replaced, deleted or unready local deployments cannot silently reuse old bindings. Raw IDs must resolve to one saved binding; ambiguity is an error.

Use `abx status report-demo` to inspect the Sandbox. When you own it and no longer need it, use `abx delete report-demo --yes`. Business calls do not renew leases or create replacement Sandboxes. File/process tools remain `abx files`, `abx process`, `abx exec` and other [platform commands](../reference/cli-commands.md), with separate availability requirements.
