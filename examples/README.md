# CLI recipes

These recipes use the [current source CLI](../README.md#installation). Run `abx --help` to check the installed
version's command surface. Credentials stay in the normal config/environment;
never place their values in a script or paste them into an Issue.

Inspect the local installation without creating a cloud resource:

```bash
abx --version
abx provider list
abx template list python
```

Run an owned sandbox and destroy it after use:

```bash
abx deploy --template-id base --name demo
# The local name resolves this deployment for subsequent operations.
abx sandbox exec demo -- echo hello
abx delete demo --yes
```

For exact options, configuration and plugin authoring, use the
[CLI reference](../docs/en/reference/cli-reference.md) and
[provider guide](../docs/en/guide/providers.md). The
[Chinese recipes](README.zh-CN.md) describe the same operations.

Use `abx template init` to create editable source: `--from` copies an existing template, `--prompt` generates from a description, and `--adopt` starts from existing code. Deploy the resulting source with `abx deploy SOURCE --name NAME`. See [Migrate from E2B](../docs/en/guide/migrate-from-e2b.md) for existing workflows.
