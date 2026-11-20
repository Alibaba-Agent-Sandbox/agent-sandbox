# Migrate from E2B CLI

Current abx uses one command surface for Express and other Providers. Migration changes command paths; replacing the executable name alone is insufficient. Standard Python imports and compatibility are documented in the [Python migration guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/migrate-from-e2b.md).

```bash
abx sandbox create --template code-interpreter-v1 --yes
abx --json list
abx sandbox exec --cwd /tmp SANDBOX_ID -- sh -c 'printf hello; exit 7'
abx sandbox connect SANDBOX_ID
abx status SANDBOX_ID
abx sandbox delete SANDBOX_ID --yes
```

Sandbox creation returns an instance ID and does not automatically open a terminal. `sandbox connect` attaches a terminal and leaves the borrowed instance running on exit. Put local exec options before the target; arguments after it belong to the remote program. Remote output and exit status are preserved. Delete only owned resources, using `--yes` in automation.

Express retains its documented `E2B_API_KEY`, `E2B_API_URL` and `E2B_DOMAIN` settings as well as project `ABX_SANDBOX_*` configuration. It uses the configured Alibaba identity without E2B browser login or Team administration. Never send Express credentials to another Provider.

Use template list/info for the catalog, init/build/publish for source, deploy for reusable resources, and sandbox create for running instances. Native cloud-template management belongs to `provider run template.list/get/create/delete`; inspect each operation’s help and permissions. A public catalog list is not a cloud-account inventory.

Pause, resume, snapshots, networking and terminal support depend on the Provider, runtime and account admission. An implemented API does not prove a default template or account is enabled. Some backends reject stdin EOF; those failures remain visible and local end-of-input is not proof that remote SANDBOX_ID stopped.

Use [operations](operations.md), [permissions](permissions.md) and current `--help`. Older installed releases may retain earlier commands; current source provides no legacy command aliases.
