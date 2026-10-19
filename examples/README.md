# CLI recipes

These recipes use an installed `abx` CLI. Run `abx --help` to check the installed
version's command surface. Credentials stay in the normal config/environment;
never place their values in a script or paste them into an Issue.

Inspect the local installation without creating a cloud resource:

```bash
abx --version
abx provider list
abx template search python
```

Run an owned sandbox and destroy it after use:

```bash
abx sandbox create --template base
# Copy the returned sandbox ID into the following commands.
abx sandbox exec REPLACE_ME -- echo hello
abx sandbox kill REPLACE_ME
```

For exact options, configuration and plugin authoring, use the
[CLI reference](../docs/en/reference/cli-reference.md) and
[provider guide](../docs/en/guide/providers.md). The
[Chinese recipes](README.zh-CN.md) describe the same operations.

For the standard Express migration contract, see [Migrate from E2B](../docs/en/guide/migrate-from-e2b.md). Create takes a positional template; natural language uses `abx create --prompt`. Project template.yaml scaffolds use `abx template scaffold`; `template init` generates standard SDK build files.
