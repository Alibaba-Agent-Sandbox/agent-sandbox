# Migrate from E2B CLI

Current abx uses one command surface for Express and other Providers. Migration changes command paths; replacing the executable name alone is insufficient. Standard Python imports and compatibility are documented in the [Python migration guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/migrate-from-e2b.md).

```bash
abx create --template code-interpreter-v1 --name work --yes
abx --json list
abx exec --cwd /tmp work -- sh -c 'printf hello; exit 7'
abx connect work
abx status work
abx delete work --yes
```

Deploy returns after creating a named instance and does not automatically open a terminal. `connect` attaches a terminal and leaves the borrowed instance running on exit. Put local exec options before the target; arguments after it belong to the remote program. Remote output and exit status are preserved. Delete only owned resources, using `--yes` in automation.

Configure Express using `ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL` and `ABX_SANDBOX_DOMAIN`, or their `abx config` keys. The current CLI does not read `E2B_API_KEY`, `E2B_API_URL` or `E2B_DOMAIN` as aliases. A Python compatibility client or MCP server may have a different documented mapping. Express uses the configured Alibaba identity without E2B browser login or Team administration. Never send Express credentials to another Provider.

Use template list/info for the catalog, init/build/publish for source, and deploy for running instances. Native cloud-template management belongs to `provider run template.list/get/create/delete`; inspect each operation’s help and permissions. A public catalog list is not a cloud-account inventory.

Pause, resume, snapshots, networking and terminal support depend on the Provider, runtime and account admission. An implemented API does not prove a default template or account is enabled. Some backends reject stdin EOF; those failures remain visible and local end-of-input is not proof that remote work stopped.

Use [operations](operations.md), [permissions](permissions.md) and current `--help`. Older installed releases may retain earlier commands; current source provides no legacy command aliases.
