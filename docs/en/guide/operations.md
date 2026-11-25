# Operations

Public commands use one parser. `--provider` selects a backend and `--json` selects machine output.

| Task | Command |
| --- | --- |
| Deploy source/catalog template | `abx deploy SOURCE --name APP` |
| Create from a native template | `abx deploy --template-id TEMPLATE --name APP` |
| List/status/logs | `abx list`, `abx status APP`, `abx logs APP` |
| Delete/recover | `abx delete APP --yes`, `abx recover APP` |
| Run a process | `abx exec APP -- COMMAND` |
| Interactive terminal | `abx connect APP` |
| Registered functions | `abx sandbox APP --help`, `abx sandbox APP NAME --body @request.json` |
| Files and process tools | `abx files --help`, `abx process --help` |
| Catalog and source | `abx template list`, `abx template info NAME`, `abx template init` |
| Build/source publication | `abx template build SOURCE --yes`, `abx template publish SOURCE --tag VERSION --yes` |
| Provider-native operations | `abx provider command list PROVIDER`, `abx provider run OPERATION --input-file request.json` |

APP is a deployment name saved on this host. Sandbox operations also accept raw IDs; managed applications use their business HTTP APIs and cannot be treated as one Sandbox. Provider writes/deletes require `--yes` in automation. Inspect operation help for JSON fields and effects.

`abx status APP` queries the saved Sandbox ID and Provider. `status` reports its current remote state; `recorded_status` describes the saved deployment operation. A confirmed missing Sandbox returns `status: missing` and `observation: not_found`. Authentication or connection errors fail the command instead of being treated as absence. If creation never recorded an ID, the current state is `unknown`. Checking status does not erase local ownership records or create a replacement.

`abx exec APP --stream -- COMMAND` streams stdout and stderr to their corresponding terminal channels. With `--json` or CI output, it returns one JSON object containing `stdout`, `stderr` and `exit_code`, and uses the command's exit code. JSON capture for streaming and Express execution is limited to 16 MiB of combined UTF-8 output. If the limit is exceeded, the CLI keeps observing the existing execution within its configured deadline and reports an error instead of returning truncated success. For larger output, save a file in the Sandbox and download it, or use terminal streaming. A stream ending without a confirmed exit code is an error; the CLI does not repeat the command.

[Get started](getting-started.md) · [Template authoring](authoring-templates.md) · [Command reference](../reference/cli-commands.md)

The target-first API interface requires a bound OpenAPI contract; see [binding and authentication](sandbox-api.md).
