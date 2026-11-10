# Operations

Public commands use one parser. `--provider` selects a backend and `--json` selects machine output.

| Task | Command |
| --- | --- |
| Deploy source/catalog template | `abx deploy SOURCE --name APP` |
| Create from a native template | `abx deploy --template-id TEMPLATE --name APP` |
| List/status/logs | `abx list`, `abx status APP`, `abx logs APP` |
| Delete/recover | `abx delete APP --yes`, `abx recover APP` |
| Run a process | `abx sandbox exec APP -- COMMAND` |
| Interactive terminal | `abx sandbox connect APP` |
| Registered functions | `abx sandbox command list APP`, `abx sandbox command run APP NAME --arg key=value` |
| Files and process tools | `abx sandbox files --help`, `abx sandbox process --help` |
| Catalog and source | `abx template list`, `abx template info NAME`, `abx template init` |
| Build/source publication | `abx template build SOURCE --yes`, `abx template publish SOURCE --tag VERSION --yes` |
| Provider-native operations | `abx provider command list PROVIDER`, `abx provider run OPERATION --input-file request.json` |

APP is a deployment name saved on this host. Sandbox operations also accept raw IDs; managed applications use their business HTTP APIs and cannot be treated as one Sandbox. Provider writes/deletes require `--yes` in automation. Inspect operation help for JSON fields and effects.

[Get started](getting-started.md) · [Template authoring](authoring-templates.md) · [Command reference](../reference/cli-commands.md)
