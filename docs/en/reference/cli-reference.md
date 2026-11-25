# CLI reference

The [command reference](cli-commands.md) is the single list of current commands and options. Use `abx --help` and a command’s `--help` for the installed build. The current command layout requires a source build; published 0.5.10 uses the previous layout.

| Task | Entry |
| --- | --- |
| Deploy, inspect and clean up | `deploy`, `list`, `status`, `logs`, `delete`, `recover` |
| Find and author templates | `template list/info/init/build/publish` |
| Execute, transfer files and connect | `exec/connect/upload/download` |
| Configure credentials and defaults | `config` |
| Install a backend or run native management operations | `provider` |
| Connect an AI tool | `mcp` |

See [configuration](configuration.md), [Provider operations](../guide/provider-commands.md), [template authoring](../guide/authoring-templates.md), and [managed applications](../guide/managed-applications.md).

Value-option aliases share their value syntax and validation. For example, `abx provider test PROVIDER --opt key=value`, `--option key=value` and `-o key=value` set the same repeatable option. Mixed aliases retain command-line order. For boolean pairs, the last explicit flag wins; absent flags use the declared environment fallback or default. This correction is in current source; published 0.5.10 users should use `--opt` or `-o`.
