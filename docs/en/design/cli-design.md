# Command responsibilities

The CLI follows the user's task rather than implementation stages. The [command reference](../reference/cli-commands.md) is the canonical syntax; keep option details there instead of copying several command catalogs.

| Task | Entry |
| --- | --- |
| Prepare and manage named resources | `deploy`, `list`, `status`, `logs`, `delete`, `recover` |
| Discover, create, build and publish reusable templates | `template` |
| Operate inside a Sandbox or use its lifecycle extensions | `sandbox` |
| Configure local defaults and credentials | `config` |
| Install a backend or run its native operations | `provider` |
| Connect an AI tool | `mcp` |

`deploy SOURCE --name NAME --yes` prepares templates, static volumes and Serving resources. `sandbox create --template ID` creates a dynamic instance. `--plan` only previews. Repeated deployment updates recorded resources; callers manage dynamic instances and their business processes.

`template init --from` only copies source. `template build` prepares a reusable artifact without creating an instance. `template publish` publishes committed source through an existing GitHub remote. Provider cloud template CRUD belongs to `provider run`.

Global output and Provider options share one parser. Exec arguments after the Sandbox name/ID belong to the remote command. Explicit command deadlines are checked before connection; sandbox lifetime is configured separately. `--ci` controls machine output and never grants permission to create or renew management credentials.

Normal interactive configuration is saved for reuse. Temporary flags and environment values do not become saved defaults. The CLI prepares default application authentication; model, platform and cloud management credentials remain separate.

Retired command aliases and the app tree are removed. The protocol helpers and Provider engine retain independent purposes. See [architecture](architecture.md), [runtime tutorial](../guide/cli-tutorial.md), [template authoring](../guide/authoring-templates.md) and [managed applications](../guide/managed-applications.md).
