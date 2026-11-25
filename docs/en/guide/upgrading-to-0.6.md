# Upgrade from CLI 0.5.10 to the 0.6 preview

The 0.6 preview changes the command layout and automation consent rules. Select the preview explicitly and check the installed version before updating scripts:

```bash
npm install -g @agent-sandbox/cli@0.6.0-alpha.2 --registry=https://registry.npmjs.org
abx --version
abx --help
```

The npm `next` channel tracks previews; `latest` retains 0.5.10. Use an exact version in reproducible automation. For a standalone executable, select `ABX_VERSION=0.6.0-alpha.2` with the [GitHub installer](binary-installation.md). The default stable installer and website mirror do not opt into previews.

Replace any downloaded alpha.0 or alpha.1 executable with alpha.2. Managed FC application build/deploy requires the npm installation and Node.js 20+; the binary retains `deploy --plan` previews. See the [managed application prerequisites](managed-applications.md).

## Update commands

| Task | 0.6 preview command |
|---|---|
| Create from a Provider template (previously `create`) | `abx create --template TEMPLATE --name demo --yes` |
| Launch a catalog or local source template (previously `template launch`) | `abx deploy TEMPLATE_OR_DIRECTORY --name demo --yes` |
| Inspect an instance (previously `info`) | `abx status TARGET` |
| Remove an instance (previously `kill`) | `abx delete TARGET --yes` |
| Create a local template project (previously `template scaffold`) | `abx template init DIRECTORY` |
| Execute a program | `abx exec TARGET -- PROGRAM ARGS` |
| Open a terminal | `abx connect TARGET` |
| Transfer files | `abx upload TARGET LOCAL_PATH REMOTE_PATH` / `abx download TARGET REMOTE_PATH LOCAL_PATH` |
| Manage files and processes | `abx files --help` / `abx process --help` |
| Discover native Provider operations | `abx --provider PROVIDER provider run --help` |

`TARGET` is an existing Sandbox ID or a deployment name saved on this host. Platform tools use root commands. `abx sandbox TARGET --help` instead discovers business operations from an explicitly bound local OpenAPI contract; `abx sandbox TARGET OPERATION --help` describes an operation, and `abx sandbox TARGET OPERATION` calls it. See [Sandbox API operations](sandbox-api.md) for binding, supported inputs and authentication. Calling an operation does not create an instance or run an unknown operation as a shell command.

The `app` command tree, `--native` parser selection, `sandbox command list/run` and overlapping lifecycle aliases are removed. For managed applications, follow the [managed application guide](managed-applications.md): `deploy`, `status`, `logs`, `recover` and `delete` manage the application. Old `app` subcommands are not interchangeable one-for-one. `recover` observes interrupted operations without repeating creation or publication; inspect any uncertain result before retrying a mutation.

Existing Server SDK decorators and HTTP routes keep their own interfaces. A former named-command invocation requires an explicit OpenAPI binding to use the new business-operation CLI; direct HTTP and SDK access remain documented by the application.

## New in alpha.2

Declared scalar parameters can use natural options such as `--id` or `--message`;
operation help shows qualified names where fields would collide. Keep `--body
@request.json` for nested JSON, or use `--body -` to read piped JSON. Save successful
binary responses with `--output FILE`, which refuses to overwrite an existing file.
Do not mix a complete body with individual body-field options.

Normal template deployment reuses the application token only when its actual
service and port were verified. Explicit binding and credentials remain available
for other applications. See [Sandbox API operations](sandbox-api.md).

MCP session deletion reports incomplete cleanup and lets the client retry the same
session. The protocol header must match the negotiated supported version. See
[MCP shutdown and retry](mcp-session-shutdown.md).

## Review automation consent

In 0.5.10, `--ci` could authorize Express managed-key creation or renewal. In the 0.6 preview, it selects noninteractive machine-readable output. It does **not** grant permission for mutations. An operation requiring confirmation needs its explicit `--yes` option; cloud managed-key creation and renewal still require that consent. Supply credentials and required configuration before running noninteractively.

```bash
abx --ci create --template base --name demo --yes
abx --ci status demo
abx --ci delete demo --yes
```

Configuration, Sandbox API credentials, application tokens and model credentials remain separate. See [guided configuration](guided-configuration.md) and the [Provider guide](providers.md) for the settings relevant to your target.

## Rebuild application images when updating the runtime

New Server SDK templates select `agent-sandbox-server==0.5.0a1`; generated MCP applications select `agent-sandbox-client[mcp]==0.5.0a1` without requiring the Server SDK. Update an existing MCP application's client requirement and redeploy it to use the session-cleanup and protocol-header fixes. To use the file-upload corrections in an existing Server SDK application, update its `agent-sandbox-server` requirement and rebuild/redeploy its image; updating the CLI alone does not replace a running application's code. Upload and download endpoints still buffer JSON/base64 content. See the [Server SDK file guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/v0.5.0a1/docs/en/guide/server-sdk.md) for policy limits.

## Keep an existing 0.5.10 script

Pin `@agent-sandbox/cli@0.5.10` and use that version's `--help` until the script has been updated. Installing an older CLI does not undo resources or deployment records created by another version. Keep the owning version and its local records available for resource cleanup.
